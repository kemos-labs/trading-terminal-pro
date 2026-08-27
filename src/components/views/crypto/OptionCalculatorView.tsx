import { useEffect, useMemo, useRef, useState } from 'react';
import { useTerminalStore } from '../../../store/terminalStore';
import {
  bsPrice,
  entryCost,
  findBreakevens,
  pnlAtExpiry,
  positionPnl,
  probProfitLognormal,
  scanExtremes,
  type CalcLeg,
  type LegSide,
  type OptionType,
  type PositionedLeg,
} from '../../../lib/options/blackscholes';
import type { ExpirySlice, OptionQuote, VolSnapshot } from '../../../lib/options/types';
import { CryptoPageHeader } from './CryptoPageHeader';
import { Panel } from '../../terminal/Panel';
import { fmtCompact, fmtPrice } from '../../../lib/format';
import { cn } from '../../../lib/utils';

// ---------------------------------------------------------------------------
// Palette (crypto desk reference system — see DERIVATIVES_MONKEY_CLONE_HANDOFF)
// ---------------------------------------------------------------------------

const TEAL = '#25d7c5';
const RED = '#e25c5c';
const AMBER = '#e8a33d';
const WHITE = '#e6edee';
const GRID_LINE = '#1a2124';
const ZERO_LINE = '#2a3438';
const AXIS_TXT = '#5c6a70';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function num(s: string): number {
  const v = Number(s);
  return isFinite(v) ? v : 0;
}

/** USD money formatter: `$12,345` style without grouping — mono tabular friendly. */
function fmtUsd(x: number, dp?: number): string {
  if (!isFinite(x)) return '—';
  const digits = dp ?? (Math.abs(x) >= 1000 ? 0 : 2);
  return `${x < 0 ? '\u2212' : ''}$${fmtPrice(Math.abs(x), digits)}`;
}

function shortDate(key: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { day: '2-digit', month: 'short', timeZone: 'UTC' })
      .format(new Date(`${key}T00:00:00Z`))
      .toUpperCase();
  } catch {
    return key.slice(0, 10);
  }
}

// ---------------------------------------------------------------------------
// Chain abstraction — live Deribit snapshot or honest manual fallback
// ---------------------------------------------------------------------------

interface ChainExpiry {
  key: string;
  label: string;
  dte: number;
  slice: ExpirySlice | null;
}

interface ChainData {
  source: 'deribit' | 'manual';
  spot: number;
  rate: number;
  divYield: number;
  expiries: ChainExpiry[];
  strikesFor: (key: string) => number[];
  quoteFor: (key: string, type: OptionType, strike: number) => OptionQuote | null;
}

function strikesFromSlice(slice: ExpirySlice): number[] {
  const set = new Set<number>();
  for (const q of slice.calls) if (q.strike > 0) set.add(q.strike);
  for (const q of slice.puts) if (q.strike > 0) set.add(q.strike);
  return [...set].sort((a, b) => a - b);
}

function manualStrikes(spot: number): number[] {
  const step = 10 ** Math.floor(Math.log10(Math.max(1, spot * 0.02)));
  const base = Math.round(spot / step) * step;
  const out: number[] = [];
  for (let i = -12; i <= 12; i++) out.push(Math.round((base + i * step) * 100) / 100);
  return out.filter((s) => s > 0);
}

function buildChain(snapshot: VolSnapshot | null): ChainData {
  if (snapshot && snapshot.spot > 0 && snapshot.expiries.length > 0) {
    const expiries: ChainExpiry[] = snapshot.expiries.map((sl) => ({
      key: sl.expiry,
      label: `${Math.max(0, sl.dte)}D \u00b7 ${shortDate(sl.expiry)}`,
      dte: sl.dte,
      slice: sl,
    }));
    const strikeCache = new Map<string, number[]>();
    for (const e of expiries) {
      if (e.slice) strikeCache.set(e.key, strikesFromSlice(e.slice));
    }
    return {
      source: 'deribit',
      spot: snapshot.spot,
      rate: snapshot.riskFreeRate ?? 0.02,
      divYield: snapshot.dividendYield ?? 0,
      expiries,
      strikesFor: (key) => strikeCache.get(key) ?? [],
      quoteFor: (key, type, strike) => {
        const sl = expiries.find((e) => e.key === key)?.slice;
        if (!sl) return null;
        const book = type === 'call' ? sl.calls : sl.puts;
        return book.find((q) => q.strike === strike) ?? null;
      },
    };
  }
  // Honest fallback: synthetic single-expiry surface, clearly labeled MANUAL.
  const spot = 75_000;
  const strikes = manualStrikes(spot);
  return {
    source: 'manual',
    spot,
    rate: 0.02,
    divYield: 0,
    expiries: [{ key: 'MANUAL-30D', label: 'MANUAL \u00b7 30D', dte: 30, slice: null }],
    strikesFor: () => strikes,
    quoteFor: () => null,
  };
}

// ---------------------------------------------------------------------------
// Strategy presets
// ---------------------------------------------------------------------------

type StrategyId =
  | 'long-call'
  | 'long-put'
  | 'short-straddle'
  | 'bull-call-spread'
  | 'iron-condor';

interface LegSpec {
  side: LegSide;
  qty: number;
  type: OptionType;
  /** Offset in strike-list steps from ATM. */
  off: number;
}

interface StrategyDef {
  id: StrategyId;
  label: string;
  tagline: string;
  legs: LegSpec[];
}

export const STRATEGIES: StrategyDef[] = [
  {
    id: 'long-call',
    label: 'Long Call',
    tagline:
      'Directional upside with risk capped at the premium paid. Gains are unbounded above the upper breakeven (strike + premium).',
    legs: [{ side: 'buy', qty: 1, type: 'call', off: 0 }],
  },
  {
    id: 'long-put',
    label: 'Long Put',
    tagline:
      'Downside protection or bearish expression. Risk capped at the premium paid; gains accelerate as spot falls below the lower breakeven.',
    legs: [{ side: 'buy', qty: 1, type: 'put', off: 0 }],
  },
  {
    id: 'short-straddle',
    label: 'Short Straddle',
    tagline:
      'Sell an ATM call and put to harvest premium decay. Profits when spot pins near the strike into expiry; losses are unbounded in either direction.',
    legs: [
      { side: 'sell', qty: 1, type: 'call', off: 0 },
      { side: 'sell', qty: 1, type: 'put', off: 0 },
    ],
  },
  {
    id: 'bull-call-spread',
    label: 'Bull Call Spread',
    tagline:
      'Buy an ATM call financed by a higher-strike short call. Lower cost and defined risk; max gain capped at the strike width minus the net debit.',
    legs: [
      { side: 'buy', qty: 1, type: 'call', off: 0 },
      { side: 'sell', qty: 1, type: 'call', off: 4 },
    ],
  },
  {
    id: 'iron-condor',
    label: 'Iron Condor',
    tagline:
      'Sell an OTM put spread and an OTM call spread around spot. Collects decay while spot stays inside the short strikes; wing width defines max risk.',
    legs: [
      { side: 'sell', qty: 1, type: 'put', off: -3 },
      { side: 'buy', qty: 1, type: 'put', off: -6 },
      { side: 'sell', qty: 1, type: 'call', off: 3 },
      { side: 'buy', qty: 1, type: 'call', off: 6 },
    ],
  },
];

const STRATEGY_MAP = new Map(STRATEGIES.map((s) => [s.id, s]));
const MAX_LEGS = 6;

/** Scenario matrix axes: IV shift rows (vols) × spot-move columns (σ). */
const SCEN_IV_ROWS = [-20, -10, 0, 10, 20];
const SCEN_SIGMA_COLS = [-2, -1, 0, 1, 2];

// ---------------------------------------------------------------------------
// UI leg state
// ---------------------------------------------------------------------------

interface UiLeg {
  id: string;
  side: LegSide;
  qtyS: string;
  type: OptionType;
  expiryKey: string;
  strike: number;
  ivPctS: string;
  premS: string;
}

let legSeq = 0;

function nearestIdx(strikes: number[], spot: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < strikes.length; i++) {
    const s = strikes[i];
    if (s == null) continue;
    const d = Math.abs(s - spot);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function strikeAtOffset(strikes: number[], atmIdx: number, off: number): number {
  const idx = Math.min(strikes.length - 1, Math.max(0, atmIdx + off));
  return strikes[idx] ?? strikes[atmIdx] ?? 0;
}

/** Build UI legs for a strategy, prefilling IV / premium from the chain when quoted. */
function buildLegs(chain: ChainData, strategyId: StrategyId): UiLeg[] {
  const def = STRATEGY_MAP.get(strategyId) ?? STRATEGIES[0]!;
  const front = chain.expiries[0];
  const expiryKey = front?.key ?? 'MANUAL-30D';
  const strikes = chain.strikesFor(expiryKey);
  const atmIdx = nearestIdx(strikes.length ? strikes : [chain.spot], chain.spot);
  return def.legs.map((spec) => {
    const strike = strikes.length ? strikeAtOffset(strikes, atmIdx, spec.off) : chain.spot;
    const quote = chain.quoteFor(expiryKey, spec.type, strike);
    const sliceIv = front?.slice?.atmIV ?? null;
    const ivDec = quote?.iv ?? sliceIv ?? 0.5;
    const premium =
      quote && quote.mid > 0 ? quote.mid : bsPrice(spec.type, chain.spot, strike, (front?.dte ?? 30) / 365, chain.rate, chain.divYield, ivDec);
    legSeq += 1;
    return {
      id: `leg-${legSeq}`,
      side: spec.side,
      qtyS: String(spec.qty),
      type: spec.type,
      expiryKey,
      strike,
      ivPctS: (ivDec * 100).toFixed(1),
      premS: premium.toFixed(2),
    } satisfies UiLeg;
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OptionCalculatorView() {
  const snapshot = useTerminalStore((s) => s.snapshot);
  const symbol = useTerminalStore((s) => s.symbol);
  const asset = symbol === 'ETH' ? 'ETH' : 'BTC';

  const chain = useMemo(() => buildChain(snapshot), [snapshot]);

  const [strategyId, setStrategyId] = useState<StrategyId>('long-call');
  const [uiLegs, setUiLegs] = useState<UiLeg[]>(() => buildLegs(chain, 'long-call'));
  const [ivShiftVols, setIvShiftVols] = useState(0);
  const [timeFrac, setTimeFrac] = useState(100);
  const [budgetS, setBudgetS] = useState('2000');

  // When the live chain arrives (manual → deribit), rebuild legs so IV /
  // premium prefills come from real marks. User edits before that point are
  // discarded — the RESET button re-runs the same path at any time.
  const appliedSourceRef = useRef(chain.source);
  const strategyRef = useRef(strategyId);
  strategyRef.current = strategyId;
  useEffect(() => {
    if (appliedSourceRef.current !== chain.source) {
      appliedSourceRef.current = chain.source;
      setUiLegs(buildLegs(chain, strategyRef.current));
    }
  }, [chain]);

  const selectStrategy = (id: StrategyId) => {
    setStrategyId(id);
    setUiLegs(buildLegs(chain, id));
  };

  const updateLeg = (id: string, patch: Partial<Pick<UiLeg, 'side' | 'qtyS' | 'type' | 'expiryKey' | 'strike' | 'ivPctS' | 'premS'>>) => {
    setUiLegs((legs) =>
      legs.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        // Structural change → refresh IV/premium from the chain mark if quoted.
        if (patch.type !== undefined || patch.expiryKey !== undefined || patch.strike !== undefined) {
          // Expiry change without an explicit strike → snap to nearest available.
          if (patch.expiryKey !== undefined && patch.strike === undefined) {
            const list = chain.strikesFor(next.expiryKey);
            if (list.length) next.strike = list[nearestIdx(list, next.strike > 0 ? next.strike : chain.spot)] ?? next.strike;
          }
          const q = chain.quoteFor(next.expiryKey, next.type, next.strike);
          const sliceIv = chain.expiries.find((e) => e.key === next.expiryKey)?.slice?.atmIV ?? null;
          if (q?.iv != null) next.ivPctS = (q.iv * 100).toFixed(1);
          else if (patch.expiryKey !== undefined && sliceIv != null) next.ivPctS = (sliceIv * 100).toFixed(1);
          if (q && q.mid > 0) next.premS = q.mid.toFixed(2);
        }
        return next;
      }),
    );
  };

  // -------------------------------------------------------------------------
  // Math assembly
  // -------------------------------------------------------------------------

  const model = useMemo(() => {
    const legs: CalcLeg[] = [];
    const dtes: number[] = [];
    for (const l of uiLegs) {
      const qty = num(l.qtyS);
      if (!(qty > 0)) continue;
      const dte = chain.expiries.find((e) => e.key === l.expiryKey)?.dte ?? 30;
      legs.push({
        id: l.id,
        side: l.side,
        qty,
        type: l.type,
        strike: l.strike > 0 ? l.strike : chain.spot,
        iv: Math.min(5, Math.max(0.005, num(l.ivPctS) / 100)),
        premium: Math.max(0, num(l.premS)),
      });
      dtes.push(dte);
    }

    const S = chain.spot;
    const r = chain.rate;
    const q = chain.divYield;
    const entry = entryCost(legs);

    let ivW = 0;
    let qtySum = 0;
    for (const l of legs) { ivW += l.qty * l.iv; qtySum += l.qty; }
    const blendedIv = qtySum > 0 ? ivW / qtySum : 0.5;

    const maxDte = Math.max(1, ...dtes);
    const yearsFull = maxDte / 365;
    const fracRem = Math.min(1, Math.max(0, timeFrac / 100));

    const positioned = (): PositionedLeg[] =>
      legs.map((l, i) => ({ ...l, T: ((dtes[i] ?? maxDte) / 365) * fracRem }));

    // Wide payoff scan for extremes / breakevens (position as entered).
    const sLo = Math.max(1, S * 0.05);
    const sHi = S * 3;
    const wide = scanExtremes((s) => pnlAtExpiry(legs, s), sLo, sHi, 1400);
    const maxGain = wide.risingAtRight ? Infinity : wide.max;
    const maxLoss = wide.fallingAtLeft ? -Infinity : wide.min;
    const riskBase = Math.abs(wide.min) > 1e-9 ? Math.abs(wide.min) : Math.max(Math.abs(entry), 1e-9);
    const breakevens = findBreakevens((s) => pnlAtExpiry(legs, s), sLo, sHi, 2400);

    // Per-set economics for position sizing (each leg qty normalized to 1).
    const oneSet = legs.map((l) => ({ ...l, qty: 1 }));
    const setWide = scanExtremes((s) => pnlAtExpiry(oneSet, s), sLo, sHi, 1400);
    const riskPerSet = Math.abs(setWide.min) > 1e-9 ? Math.abs(setWide.min) : Math.max(Math.abs(entryCost(oneSet)), 1e-9);
    const gainPerSet = setWide.risingAtRight ? Infinity : setWide.max;

    // Probability of profit at expiry under the blended-IV log-normal.
    const pop = probProfitLognormal((s) => pnlAtExpiry(legs, s), S, yearsFull, r, q, blendedIv);

    // Scenario geometry: ±kσ spot moves on the evaluation horizon.
    const tEval = yearsFull * fracRem;
    const sigMove = blendedIv * Math.sqrt(Math.max(tEval, 1 / (365 * 24)));
    const spotAtSigma = (k: number) => S * Math.exp(k * sigMove);
    const pnlOnHorizon = (spot: number, shiftVols: number) =>
      positionPnl(positioned(), spot, r, q, shiftVols / 100);

    return {
      legs, legDtes: dtes, S, r, q, entry, blendedIv, maxDte, yearsFull, fracRem,
      maxGain, maxLoss, riskBase, breakevens,
      riskPerSet, gainPerSet,
      pop, tEval, sigMove, spotAtSigma, pnlOnHorizon,
      wide,
    };
  }, [uiLegs, chain, timeFrac]);

  const strategyDef = STRATEGY_MAP.get(strategyId) ?? STRATEGIES[0]!;
  const dataSourceLabel = chain.source === 'deribit' ? 'DERIBIT LIVE CHAIN' : 'MANUAL INPUT';
  const daysLeft = model.maxDte * model.fracRem;

  // -------------------------------------------------------------------------
  // Chart geometry
  // -------------------------------------------------------------------------

  const chart = useMemo(() => {
    const W = 960;
    const H = 300;
    const ML = 56;
    const MR = 14;
    const MT = 14;
    const MB = 26;

    const beSpan = model.breakevens.length
      ? Math.max(...model.breakevens.map((b) => Math.abs(b - model.S)))
      : 0;
    const half = Math.min(
      0.7,
      Math.max(0.15, beSpan / model.S * 1.35, model.blendedIv * Math.sqrt(model.yearsFull) * 2.2),
    );
    const xMin = model.S * (1 - half);
    const xMax = model.S * (1 + half);

    const N = 220;
    const fracs: { key: string; frac: number }[] = [
      { key: 'expiry', frac: 0 },
      { key: 'd2', frac: Math.min(1, 2 / model.maxDte) },
      { key: 'd1', frac: Math.min(1, 1 / model.maxDte) },
      { key: 'now', frac: model.fracRem },
    ];
    const positionedAt = (frac: number): PositionedLeg[] =>
      model.legs.map((l, i) => ({ ...l, T: ((model.legDtes[i] ?? model.maxDte) / 365) * frac }));
    const curves = fracs.map(({ key, frac }) => ({
      key,
      pts: Array.from({ length: N + 1 }, (_, i) => {
        const x = xMin + ((xMax - xMin) * i) / N;
        return { x, y: positionPnl(positionedAt(frac), x, model.r, model.q, ivShiftVols / 100) };
      }),
    }));

    let yMin = 0;
    let yMax = 0;
    for (const c of curves) {
      for (const p of c.pts) {
        if (p.y < yMin) yMin = p.y;
        if (p.y > yMax) yMax = p.y;
      }
    }
    const padY = Math.max((yMax - yMin) * 0.08, 1);
    yMin -= padY;
    yMax += padY;

    const X = (x: number) => ML + ((x - xMin) / (xMax - xMin)) * (W - ML - MR);
    const Y = (y: number) => MT + ((yMax - y) / (yMax - yMin)) * (H - MT - MB);
    const dxPx = (W - ML - MR) / N;

    const xTicks: number[] = [];
    for (let i = 0; i <= 6; i++) xTicks.push(xMin + ((xMax - xMin) * i) / 6);
    const yTicks: number[] = [];
    for (let i = 0; i <= 4; i++) yTicks.push(yMin + ((yMax - yMin) * i) / 4);

    return {
      W, H, X, Y, dxPx, xTicks, yTicks, curves, xMin, xMax, yMin, yMax,
      besInDomain: model.breakevens.filter((b) => b >= xMin && b <= xMax),
    };
  }, [model, ivShiftVols]);

  const pathFor = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${chart.X(p.x).toFixed(1)},${chart.Y(p.y).toFixed(1)}`).join('');

  // -------------------------------------------------------------------------
  // Scenario matrix
  // -------------------------------------------------------------------------

  const scenCells = useMemo(() =>
    SCEN_IV_ROWS.map((ivV) =>
      SCEN_SIGMA_COLS.map((k) => {
        const spot = model.spotAtSigma(k);
        const pnl = model.pnlOnHorizon(spot, ivV);
        const pctRisk = (pnl / model.riskBase) * 100;
        return { ivV, k, spot, pnl, pctRisk };
      }),
    ),
    [model],
  );

  function cellColor(pct: number): string {
    const a = Math.min(0.62, 0.08 + Math.abs(pct) / 130);
    return pct >= 0
      ? `rgba(37, 215, 197, ${a.toFixed(3)})`
      : `rgba(226, 92, 92, ${a.toFixed(3)})`;
  }

  // -------------------------------------------------------------------------
  // Position sizing
  // -------------------------------------------------------------------------

  const budget = Math.max(0, num(budgetS));
  const sets = model.riskPerSet > 1e-6 ? Math.floor(budget / model.riskPerSet) : 0;
  const deployed = sets * model.riskPerSet;
  const setPnlPlus1 = model.pnlOnHorizon(model.spotAtSigma(1), 0);
  const setPnlMinus1 = model.pnlOnHorizon(model.spotAtSigma(-1), 0);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden bg-[#030506]" data-testid="option-calculator">
      <CryptoPageHeader
        title="Option"
        highlight="Calculator"
        description={`Multi-leg Black-Scholes P&L workbench for ${asset}: strategy presets, live Deribit strikes/expiries with mark IV prefill, payoff profile, scenario heat and position sizing.`}
        actions={
          <>
            <span
              className={cn(
                'border px-2 py-1 font-mono text-[9px] uppercase tracking-wider',
                chain.source === 'deribit'
                  ? 'border-[#25d7c5]/40 bg-[#25d7c5]/10 text-[#25d7c5]'
                  : 'border-[#e8a33d]/40 bg-[#e8a33d]/10 text-[#e8a33d]',
              )}
            >
              {dataSourceLabel}
            </span>
            <span className="border border-[#202629] bg-[#0a0e10] px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-white">
              {asset} {fmtUsd(chain.spot, chain.spot >= 1000 ? 0 : 2)}
            </span>
          </>
        }
      />

      {chain.source !== 'deribit' && (
        <div className="border-b border-l-2 border-[#20282b] border-l-[#e8a33d] bg-[#12100a] px-4 py-2 font-mono text-[10px] leading-relaxed text-[#c8b98a]">
          Live Deribit chain unavailable — calculator is running on manual inputs (fixed $75,000 spot,
          30-DTE manual expiry, editable IV/premium). All analytics remain fully functional; values are
          NOT market marks until the chain connects.
        </div>
      )}

      {/* Strategy selector */}
      <div className="border-b border-[#20282b] px-2 pb-2 pt-2 lg:px-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {STRATEGIES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => selectStrategy(s.id)}
              aria-pressed={strategyId === s.id}
              className={cn(
                'border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors',
                strategyId === s.id
                  ? 'border-[#25d7c5] bg-[#25d7c5]/10 text-[#25d7c5]'
                  : 'border-[#202629] bg-[#0a0e10] text-[#8b999f] hover:border-[#25d7c5]/40 hover:text-white',
              )}
            >
              {s.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setIvShiftVols(0); setTimeFrac(100); selectStrategy(strategyId); }}
            className="ml-auto border border-[#202629] bg-[#0a0e10] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[#8b999f] hover:border-[#e8a33d]/50 hover:text-white"
          >
            Reset
          </button>
        </div>
        <p className="mt-1.5 max-w-[130ch] font-mono text-[11px] leading-snug text-[#8b999f]">
          {strategyDef.tagline}
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-px border-b border-[#20282b] bg-[#20282b] md:grid-cols-4">
        <div className="bg-[#090c0d] p-3" data-testid="kpi-entry">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Entry Cost</div>
          <div className="font-mono text-[18px] font-bold tabular-nums text-white">{fmtUsd(model.entry)}</div>
          <div className={cn('font-mono text-[10px]', model.entry >= 0 ? 'text-[#e8a33d]' : 'text-[#25d7c5]')}>
            {model.entry >= 0 ? 'DEBIT PAID' : 'CREDIT RECEIVED'}
          </div>
        </div>
        <div className="bg-[#090c0d] p-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Max Gain</div>
          <div className="font-mono text-[18px] font-bold tabular-nums text-[#25d7c5]">
            {isFinite(model.maxGain) ? fmtUsd(model.maxGain, 0) : 'UNBOUNDED'}
          </div>
          <div className="font-mono text-[10px] text-[#76848a]">at expiry</div>
        </div>
        <div className="bg-[#090c0d] p-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Max Loss</div>
          <div className="font-mono text-[18px] font-bold tabular-nums text-[#e25c5c]">
            {isFinite(model.maxLoss) ? fmtUsd(model.maxLoss, 0) : 'UNBOUNDED'}
          </div>
          <div className="font-mono text-[10px] text-[#76848a]">at expiry</div>
        </div>
        <div className="bg-[#090c0d] p-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Return / Risk</div>
          <div className="font-mono text-[18px] font-bold tabular-nums text-white">
            {isFinite(model.maxGain) ? `${fmtPrice((model.maxGain / model.riskBase) * 100, 0)}%` : '\u221e'}
          </div>
          <div className="font-mono text-[10px] text-[#76848a]">
            {fmtCompact(Math.max(0, model.maxGain))} / {fmtCompact(model.riskBase)} risk
          </div>
        </div>
        <div className="bg-[#090c0d] p-3 md:col-span-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Breakevens</div>
          <div className="truncate font-mono text-[18px] font-bold tabular-nums text-[#e8a33d]">
            {model.breakevens.length
              ? model.breakevens.slice(0, 3).map((b) => fmtUsd(b, 0)).join('  \u00b7  ')
              : 'NONE IN RANGE'}
          </div>
          <div className="font-mono text-[10px] text-[#76848a]">{model.breakevens.length} crossing(s) at expiry</div>
        </div>
        <div className="bg-[#090c0d] p-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Prob. of Profit</div>
          <div className="font-mono text-[18px] font-bold tabular-nums text-white">{fmtPrice(model.pop * 100, 1)}%</div>
          <div className="font-mono text-[10px] text-[#76848a]">log-normal @ {(model.blendedIv * 100).toFixed(1)}% IV</div>
        </div>
        <div className="bg-[#090c0d] p-3">
          <div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Eval Horizon</div>
          <div className="font-mono text-[18px] font-bold tabular-nums text-white">{fmtPrice(daysLeft, 1)}d</div>
          <div className="font-mono text-[10px] text-[#76848a]">
            shift {ivShiftVols > 0 ? '+' : ''}{ivShiftVols} vols
          </div>
        </div>
      </div>

      {/* Legs editor */}
      <div className="px-2 pt-2">
        <Panel title="Legs" subtitle={`${uiLegs.length}/${MAX_LEGS} legs · IV & premium prefilled from chain marks where quoted`}>
          <div className="overflow-x-auto p-2">
            <div className="min-w-[860px]">
              <div className="flex items-center gap-2 px-1 pb-1 font-mono text-[9px] uppercase tracking-wider text-[#76848a]">
                <span className="w-[52px]">Side</span>
                <span className="w-[58px]">Qty</span>
                <span className="w-[64px]">Type</span>
                <span className="w-[128px]">Expiry</span>
                <span className="w-[110px]">Strike</span>
                <span className="w-[74px]">IV %</span>
                <span className="w-[92px]">Premium $</span>
                <span />
              </div>
              {uiLegs.map((leg, i) => (
                <div
                  key={leg.id}
                  className="mb-1 flex flex-wrap items-center gap-2 border border-[#161c1f] bg-[#07090b] px-1 py-1.5"
                >
                  <span className="w-[52px]">
                    <button
                      type="button"
                      onClick={() => updateLeg(leg.id, { side: leg.side === 'buy' ? 'sell' : 'buy' })}
                      className={cn(
                        'w-full border px-1 py-1 font-mono text-[10px] font-bold tracking-wide',
                        leg.side === 'buy'
                          ? 'border-[#25d7c5]/60 bg-[#25d7c5]/10 text-[#25d7c5]'
                          : 'border-[#e25c5c]/60 bg-[#e25c5c]/10 text-[#e25c5c]',
                      )}
                    >
                      {leg.side.toUpperCase()}
                    </button>
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={leg.qtyS}
                    onChange={(e) => updateLeg(leg.id, { qtyS: e.target.value })}
                    aria-label={`Qty ${i + 1}`}
                    className="w-[58px] border border-[#202629] bg-[#030506] px-1.5 py-1 font-mono text-[11px] tabular-nums text-white outline-none focus:border-[#25d7c5]/60"
                  />
                  <span className="w-[64px]">
                    <button
                      type="button"
                      onClick={() => updateLeg(leg.id, { type: leg.type === 'call' ? 'put' : 'call' })}
                      className={cn(
                        'w-full border px-1 py-1 font-mono text-[10px] font-bold tracking-wide',
                        leg.type === 'call'
                          ? 'border-[#25d7c5]/40 text-[#25d7c5]'
                          : 'border-[#e25c5c]/40 text-[#e25c5c]',
                      )}
                    >
                      {leg.type.toUpperCase()}
                    </button>
                  </span>
                  <select
                    value={leg.expiryKey}
                    onChange={(e) => updateLeg(leg.id, { expiryKey: e.target.value })}
                    aria-label={`Expiry ${i + 1}`}
                    className="w-[128px] border border-[#202629] bg-[#030506] px-1 py-1 font-mono text-[11px] text-white outline-none focus:border-[#25d7c5]/60"
                  >
                    {chain.expiries.map((e) => (
                      <option key={e.key} value={e.key}>{e.label}</option>
                    ))}
                  </select>
                  <select
                    value={leg.strike}
                    onChange={(e) => updateLeg(leg.id, { strike: Number(e.target.value) })}
                    aria-label={`Strike ${i + 1}`}
                    className="w-[110px] border border-[#202629] bg-[#030506] px-1 py-1 font-mono text-[11px] tabular-nums text-white outline-none focus:border-[#25d7c5]/60"
                  >
                    {chain.strikesFor(leg.expiryKey).map((k) => (
                      <option key={k} value={k}>{fmtPrice(k, k >= 1000 ? 0 : 2)}</option>
                    ))}
                  </select>
                  <span className="flex w-[74px] items-center gap-0.5">
                    <input
                      type="number"
                      min={0.1}
                      step={0.5}
                      value={leg.ivPctS}
                      onChange={(e) => updateLeg(leg.id, { ivPctS: e.target.value })}
                      aria-label={`IV percent ${i + 1}`}
                      className="w-full border border-[#202629] bg-[#030506] px-1.5 py-1 font-mono text-[11px] tabular-nums text-white outline-none focus:border-[#25d7c5]/60"
                    />
                    <span className="font-mono text-[9px] text-[#76848a]">%</span>
                  </span>
                  <span className="flex w-[92px] items-center gap-0.5">
                    <span className="font-mono text-[9px] text-[#76848a]">$</span>
                    <input
                      type="number"
                      min={0}
                      step={10}
                      value={leg.premS}
                      onChange={(e) => updateLeg(leg.id, { premS: e.target.value })}
                      aria-label={`Premium ${i + 1}`}
                      className="w-full border border-[#202629] bg-[#030506] px-1.5 py-1 font-mono text-[11px] tabular-nums text-white outline-none focus:border-[#25d7c5]/60"
                    />
                  </span>
                  <button
                    type="button"
                    onClick={() => setUiLegs((legs) => (legs.length > 1 ? legs.filter((l) => l.id !== leg.id) : legs))}
                    disabled={uiLegs.length <= 1}
                    aria-label={`Remove leg ${i + 1}`}
                    className="ml-auto border border-transparent px-1.5 py-1 font-mono text-[11px] text-[#76848a] hover:text-[#e25c5c] disabled:opacity-30"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  if (uiLegs.length >= MAX_LEGS) return;
                  legSeq += 1;
                  const last = uiLegs[uiLegs.length - 1];
                  setUiLegs((legs) => [
                    ...legs,
                    {
                      id: `leg-${legSeq}`,
                      side: 'buy' as LegSide,
                      qtyS: '1',
                      type: 'call' as OptionType,
                      expiryKey: last?.expiryKey ?? chain.expiries[0]?.key ?? 'MANUAL-30D',
                      strike: last?.strike ?? chain.spot,
                      ivPctS: last?.ivPctS ?? '50.0',
                      premS: last?.premS ?? '0.00',
                    },
                  ]);
                }}
                disabled={uiLegs.length >= MAX_LEGS}
                className="mt-1 border border-dashed border-[#202629] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-[#8b999f] hover:border-[#25d7c5]/40 hover:text-white disabled:opacity-30"
              >
                + Add leg
              </button>
            </div>
          </div>
        </Panel>
      </div>

      {/* Sliders + payoff chart */}
      <div className="grid gap-2 p-2 xl:grid-cols-[minmax(0,1fr)_300px]">
        <Panel title="Payoff Profile" subtitle="P&L vs spot · expiry, now, 1 DTE and 2 DTE (BSM repriced)">
          <div className="flex h-full flex-col p-2">
            {/* Legend */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pb-2 font-mono text-[10px] text-[#8b999f]">
              <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4" style={{ background: WHITE }} />AT EXPIRY</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4" style={{ background: TEAL }} />NOW · {fmtPrice(daysLeft, 1)}D LEFT</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4" style={{ background: '#8b999f' }} />1 DTE</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4" style={{ background: AXIS_TXT }} />2 DTE</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: AMBER }} />BREAKEVEN</span>
              <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-4" style={{ background: TEAL, opacity: 0.5 }} />SPOT {fmtUsd(model.S, 0)}</span>
            </div>
            <svg
              viewBox="0 0 960 300"
              className="h-auto w-full flex-1"
              role="img"
              aria-label="Payoff chart: position P&L versus underlying spot at expiry and interim horizons"
            >
              {/* horizontal grid */}
              {chart.yTicks.map((t) => (
                <g key={`hy${t}`}>
                  <line x1={chart.X(chart.xMin)} x2={chart.X(chart.xMax)} y1={chart.Y(t)} y2={chart.Y(t)} stroke={GRID_LINE} strokeWidth={1} />
                  <text x={chart.X(chart.xMin) - 6} y={chart.Y(t) + 3} fill={AXIS_TXT} fontSize={9} textAnchor="end" fontFamily="'JetBrains Mono', monospace">
                    {fmtCompact(t)}
                  </text>
                </g>
              ))}
              {/* vertical grid */}
              {chart.xTicks.map((t) => (
                <g key={`vx${t}`}>
                  <line x1={chart.X(t)} x2={chart.X(t)} y1={chart.H - 26} y2={14} stroke={GRID_LINE} strokeWidth={1} />
                  <text x={chart.X(t)} y={chart.H - 8} fill={AXIS_TXT} fontSize={9} textAnchor="middle" fontFamily="'JetBrains Mono', monospace">
                    {fmtPrice(t, 0)}
                  </text>
                </g>
              ))}
              {/* zero P&L line */}
              <line x1={chart.X(chart.xMin)} x2={chart.X(chart.xMax)} y1={chart.Y(0)} y2={chart.Y(0)} stroke={ZERO_LINE} strokeWidth={1.2} />
              {/* signed area under the NOW curve */}
              {chart.curves.find((c) => c.key === 'now')?.pts.map((p, i) =>
                Math.abs(p.y) < 1e-9 ? null : (
                  <rect
                    key={`ar${i}`}
                    x={chart.X(p.x)}
                    width={Math.max(1, chart.dxPx + 0.5)}
                    y={Math.min(chart.Y(p.y), chart.Y(0))}
                    height={Math.abs(chart.Y(0) - chart.Y(p.y))}
                    fill={p.y >= 0 ? TEAL : RED}
                    opacity={0.1}
                  />
                ),
              )}
              {/* curves: 2 DTE dotted, 1 DTE dashed, expiry white, now teal */}
              <path d={pathFor(chart.curves.find((c) => c.key === 'd2')?.pts ?? [])} fill="none" stroke={AXIS_TXT} strokeWidth={1.2} strokeDasharray="2 4" />
              <path d={pathFor(chart.curves.find((c) => c.key === 'd1')?.pts ?? [])} fill="none" stroke="#8b999f" strokeWidth={1.2} strokeDasharray="5 4" />
              <path d={pathFor(chart.curves.find((c) => c.key === 'expiry')?.pts ?? [])} fill="none" stroke={WHITE} strokeWidth={1.6} />
              <path d={pathFor(chart.curves.find((c) => c.key === 'now')?.pts ?? [])} fill="none" stroke={TEAL} strokeWidth={2.2} />
              {/* breakeven markers */}
              {chart.besInDomain.map((b) => (
                <g key={`be${b}`}>
                  <circle cx={chart.X(b)} cy={chart.Y(0)} r={3.5} fill="#030506" stroke={AMBER} strokeWidth={1.5} />
                  <text x={chart.X(b)} y={chart.Y(0) - 8} fill={AMBER} fontSize={9} textAnchor="middle" fontFamily="'JetBrains Mono', monospace">
                    BE {fmtPrice(b, 0)}
                  </text>
                </g>
              ))}
              {/* spot marker */}
              <line x1={chart.X(model.S)} x2={chart.X(model.S)} y1={14} y2={chart.H - 26} stroke={TEAL} strokeDasharray="3 3" strokeWidth={1} opacity={0.7} />
              <text x={chart.X(model.S) + 4} y={24} fill={TEAL} fontSize={9} fontFamily="'JetBrains Mono', monospace">
                SPOT {fmtPrice(model.S, 0)}
              </text>
            </svg>

            {/* Sliders */}
            <div className="mt-2 grid gap-3 px-1 sm:grid-cols-2">
              <label className="block">
                <span className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">
                  IV shift
                  <span className={cn('tabular-nums', ivShiftVols >= 0 ? 'text-[#25d7c5]' : 'text-[#e25c5c]')}>
                    {ivShiftVols > 0 ? '+' : ''}{ivShiftVols} vols
                  </span>
                </span>
                <input
                  type="range"
                  min={-30}
                  max={30}
                  step={1}
                  value={ivShiftVols}
                  onChange={(e) => setIvShiftVols(Number(e.target.value))}
                  aria-label="IV shift in vols"
                  className="mt-1 w-full accent-[#25d7c5]"
                />
              </label>
              <label className="block">
                <span className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">
                  Time to expiry
                  <span className="tabular-nums text-white">{timeFrac}% · {fmtPrice(daysLeft, 1)}d left</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={timeFrac}
                  onChange={(e) => setTimeFrac(Number(e.target.value))}
                  aria-label="Time to expiry percent"
                  className="mt-1 w-full accent-[#25d7c5]"
                />
              </label>
            </div>
          </div>
        </Panel>

        {/* Position sizing */}
        <Panel title="Position Sizing" subtitle="Max-risk budget → sets & estimated returns">
          <div className="flex h-full flex-col gap-2 p-2">
            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Max risk ($)</span>
              <input
                type="number"
                min={0}
                step={100}
                value={budgetS}
                onChange={(e) => setBudgetS(e.target.value)}
                aria-label="Max risk budget dollars"
                className="mt-1 w-full border border-[#202629] bg-[#030506] px-2 py-1.5 font-mono text-[13px] tabular-nums text-white outline-none focus:border-[#25d7c5]/60"
              />
            </label>
            <div className="divide-y divide-[#141a1c] border border-[#161c1f] bg-[#07090b] font-mono text-[11px]">
              {[
                ['RISK / SET', fmtUsd(model.riskPerSet)],
                ['SETS', String(sets)],
                ['DEPLOYED RISK', fmtUsd(deployed)],
                ['MAX GAIN', isFinite(model.gainPerSet) ? `${fmtUsd(sets * model.gainPerSet, 0)} (${fmtPrice(sets > 0 && isFinite(model.gainPerSet) ? ((model.gainPerSet / model.riskPerSet) * 100) : NaN, 0)}%)` : 'UNBOUNDED'],
                ['P&L @ +1\u03c3', `${fmtUsd(sets * setPnlPlus1, 0)} (${fmtUsd(setPnlPlus1, 0)}/set)`],
                ['P&L @ \u22121\u03c3', `${fmtUsd(sets * setPnlMinus1, 0)} (${fmtUsd(setPnlMinus1, 0)}/set)`],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-[#76848a]">{k}</span>
                  <span className={cn('tabular-nums', (v ?? '').startsWith('-') || (v ?? '').startsWith('\u2212') ? 'text-[#e25c5c]' : 'text-[#d7dee0]')}>{v}</span>
                </div>
              ))}
            </div>
            <p className="mt-auto px-1 font-mono text-[9px] leading-relaxed text-[#76848a]">
              A “set” is one unit of the selected strategy (every leg qty = 1). Sets = floor(budget ÷ risk per set).
              ±1σ figures use the evaluation horizon ({fmtPrice(daysLeft, 1)}d) at unchanged IV.
            </p>
          </div>
        </Panel>
      </div>

      {/* Scenario matrix */}
      <div className="px-2 pb-3">
        <Panel
          title="Scenario Matrix"
          subtitle={`Position P&L as % of risk (${fmtUsd(model.riskBase, 0)}) · evaluated with ${fmtPrice(daysLeft, 1)}d remaining`}
        >
          <div className="overflow-x-auto p-2">
            <table className="w-full min-w-[620px] border-collapse font-mono text-[11px]">
              <thead>
                <tr className="text-[#8b999f]">
                  <th className="border border-[#161c1f] bg-[#0a0d0e] px-2 py-1.5 text-left text-[9px] uppercase tracking-wider">
                    IV \ SPOT
                  </th>
                  {scenCells[0]?.map((c) => (
                    <th key={`h${c.k}`} className="border border-[#161c1f] bg-[#0a0d0e] px-2 py-1.5 text-right">
                      <div className="text-[10px] text-[#a6b0b4]">{c.k > 0 ? '+' : ''}{c.k}σ</div>
                      <div className="text-[9px] font-normal text-[#76848a]">{fmtPrice(c.spot, 0)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scenCells.map((row, ri) => (
                  <tr key={`r${row[0]?.ivV ?? ri}`}>
                    <td className="border border-[#161c1f] bg-[#0a0d0e] px-2 py-1.5 text-left">
                      <span className={cn('tabular-nums', (row[0]?.ivV ?? 0) >= 0 ? 'text-[#25d7c5]' : 'text-[#e25c5c]')}>
                        {(row[0]?.ivV ?? 0) > 0 ? '+' : ''}{row[0]?.ivV ?? 0}v
                      </span>
                    </td>
                    {row.map((cell) => (
                      <td
                        key={`${cell.ivV}:${cell.k}`}
                        data-testid="scen-cell"
                        title={`IV ${cell.ivV > 0 ? '+' : ''}${cell.ivV} vols · spot ${fmtPrice(cell.spot, 0)} → P&L ${fmtUsd(cell.pnl)} (${fmtPrice(cell.pctRisk, 0)}% of risk)`}
                        className="border border-[#161c1f] px-2 py-1.5 text-right tabular-nums text-white"
                        style={{ background: cellColor(cell.pctRisk) }}
                      >
                        {cell.pctRisk > 0 ? '+' : ''}{fmtPrice(cell.pctRisk, 0)}%
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-1 pt-2 font-mono text-[9px] leading-relaxed text-[#76848a]">
              Columns shift spot ±kσ with σ = blended IV × √(horizon) = {fmtPrice(model.sigMove * 100, 1)}% per 1σ
              ({fmtUsd(model.S * model.sigMove, 0)}). Rows shift every leg's IV in parallel. Cells are BSM mark-to-model
              P&L divided by the position's max-loss-at-expiry risk. Green = profit, red = loss.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
