/**
 * KSA Market Pulse — Tadawul (Main + Nomu) via shared SAHMK board.
 * Depth charts from board pack + warmer history ring (no extra SAHMK calls).
 * Prices in SAR. Session Sun–Thu Riyadh. Free tier = delayed + hard cache.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Panel } from '../terminal/Panel';
import { EmptyState } from '../common/EmptyState';
import { SectionErrorBoundary } from '../common/SectionErrorBoundary';
import { FreshnessChip } from '../common/Freshness';
import { DeskChartFrame, deskChartChrome } from '../desk/DeskChart';
import { CHART } from '../../lib/chartTheme';
import { fmtCompact, fmtPrice, fmtSigned } from '../../lib/format';
import { cn } from '../../lib/utils';
import {
  fetchKsaBoardClient,
  KSA_BOARD_POLL_MS,
  type KsaBoard,
  type KsaMover,
  type KsaQuote,
} from '../../lib/data/ksaClient';
import { riyadhSessionSnapshot } from '../../lib/data/ksaSession';

function findFocusOnBoard(board: KsaBoard | null, sym: string): KsaQuote | KsaMover | null {
  if (!board) return null;
  const pools = [
    board.mega,
    board.gainers,
    board.losers,
    board.volumeLeaders,
    board.valueLeaders,
  ];
  for (const pool of pools) {
    const hit = (pool || []).find((m) => String(m.symbol) === sym && m.price != null);
    if (hit) return hit;
  }
  return null;
}

function chgClass(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'text-muted-foreground';
  if (n > 0) return 'text-up';
  if (n < 0) return 'text-down';
  return 'text-muted-foreground';
}

function IndexCard({
  label,
  value,
  change,
  changePct,
  volume,
  mood,
  adv,
  dec,
}: {
  label: string;
  value?: number;
  change?: number;
  changePct?: number;
  volume?: number;
  mood?: string;
  adv?: number;
  dec?: number;
}) {
  return (
    <div className="min-w-[140px] flex-1 rounded border border-border bg-card/60 px-2.5 py-2">
      <div className="text-type-xs font-mono text-muted-foreground">{label}</div>
      <div className="font-mono text-lg font-semibold tabular-nums">
        {value != null ? fmtPrice(value, 2) : '—'}
      </div>
      <div className={cn('font-mono text-type-xs tabular-nums', chgClass(changePct))}>
        {change != null ? fmtSigned(change, 2) : '—'}{' '}
        {changePct != null ? `(${fmtSigned(changePct, 2)}%)` : ''}
      </div>
      <div className="mt-1 font-mono text-type-2xs text-muted-foreground">
        {volume != null && <span>Vol {fmtCompact(volume)}</span>}
        {adv != null && dec != null && (
          <span className="ml-2">
            ↑{adv} ↓{dec}
          </span>
        )}
        {mood && <span className="ml-2">{mood}</span>}
      </div>
    </div>
  );
}

function MoverTable({
  title,
  rows,
  mode,
  onPick,
}: {
  title: string;
  rows: KsaMover[];
  mode: 'pct' | 'vol' | 'val';
  onPick: (sym: string) => void;
}) {
  return (
    <Panel title={title} className="min-h-0 flex-1" data-testid="ksa-view">
      <div className="max-h-[220px] overflow-auto">
        <table className="w-full font-mono text-type-xs">
          <thead className="sticky top-0 bg-card text-muted-foreground">
            <tr>
              <th className="px-1.5 py-1 text-left font-medium">Sym</th>
              <th className="px-1.5 py-1 text-left font-medium">Name</th>
              <th className="px-1.5 py-1 text-right font-medium">Last</th>
              <th className="px-1.5 py-1 text-right font-medium">
                {mode === 'pct' ? '%' : mode === 'vol' ? 'Vol' : 'Value'}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-1.5 py-3 text-muted-foreground">
                  No rows
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.symbol}
                className="cursor-pointer border-t border-border/50 hover:bg-secondary/40"
                onClick={() => onPick(r.symbol)}
              >
                <td className="px-1.5 py-1 text-info">{r.symbol}</td>
                <td className="max-w-[120px] truncate px-1.5 py-1 text-muted-foreground">
                  {r.name_en || r.name || '—'}
                </td>
                <td className="px-1.5 py-1 text-right tabular-nums">{fmtPrice(r.price, 2)}</td>
                <td className={cn('px-1.5 py-1 text-right tabular-nums', mode === 'pct' && chgClass(r.change_percent))}>
                  {mode === 'pct' && r.change_percent != null
                    ? `${fmtSigned(r.change_percent, 2)}%`
                    : mode === 'vol'
                      ? fmtCompact(r.volume)
                      : fmtCompact(r.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function MegaChip({
  q,
  active,
  onClick,
}: {
  q: KsaQuote;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-w-[100px] rounded border px-2 py-1.5 text-left font-mono transition-colors',
        active ? 'border-info/50 bg-info/10' : 'border-border bg-card/50 hover:border-border',
      )}
    >
      <div className="text-type-2xs text-muted-foreground">{q.symbol}</div>
      <div className="truncate text-type-xs">{q.name_en?.split(' ').slice(0, 2).join(' ') || q.name || '—'}</div>
      <div className="text-sm font-semibold tabular-nums">{fmtPrice(q.price, 2)} SAR</div>
      <div className={cn('text-type-2xs tabular-nums', chgClass(q.change_percent))}>
        {q.change_percent != null ? `${fmtSigned(q.change_percent, 2)}%` : '—'}
      </div>
    </button>
  );
}

function FocusQuote({ q }: { q: KsaQuote | null }) {
  if (!q || q.error) {
    return (
      <Panel title="Focus">
        <p className="px-2 py-3 font-mono text-type-xs text-muted-foreground">
          Select a mega-cap or mover. Symbols are numeric (e.g. 2222 Aramco).
        </p>
      </Panel>
    );
  }
  const spread =
    q.bid != null && q.ask != null && q.bid > 0
      ? ((q.ask - q.bid) / ((q.bid + q.ask) / 2)) * 10_000
      : null;
  const liq = q.liquidity;

  return (
    <Panel title={`${q.symbol} · ${q.name_en || q.name || 'Quote'} · SAR`}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 px-2 py-2 font-mono text-type-xs sm:grid-cols-4 md:grid-cols-6">
        <Stat label="Last" value={fmtPrice(q.price, 2)} />
        <Stat label="Chg%" value={q.change_percent != null ? `${fmtSigned(q.change_percent, 2)}%` : '—'} className={chgClass(q.change_percent)} />
        <Stat label="Open" value={fmtPrice(q.open, 2)} />
        <Stat label="High" value={fmtPrice(q.high, 2)} />
        <Stat label="Low" value={fmtPrice(q.low, 2)} />
        <Stat label="Prev" value={fmtPrice(q.previous_close, 2)} />
        <Stat label="Bid" value={q.bid != null ? `${fmtPrice(q.bid, 2)} ×${q.bid_size ?? '—'}` : '—'} />
        <Stat label="Ask" value={q.ask != null ? `${fmtPrice(q.ask, 2)} ×${q.ask_size ?? '—'}` : '—'} />
        <Stat label="Spread" value={spread != null ? `${spread.toFixed(1)} bps` : '—'} />
        <Stat label="Volume" value={fmtCompact(q.volume)} />
        <Stat label="Value" value={fmtCompact(q.value)} />
        <Stat label="Net flow" value={liq?.net_value != null ? fmtCompact(liq.net_value) : '—'} className={chgClass(liq?.net_value)} />
      </div>
      {liq && (
        <div className="border-t border-border px-2 py-1.5 font-mono text-type-2xs text-muted-foreground">
          Inflow {fmtCompact(liq.inflow_value)} · Outflow {fmtCompact(liq.outflow_value)}
          {q.is_delayed !== false && ' · delayed when free tier'}
        </div>
      )}
    </Panel>
  );
}

function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className={cn('tabular-nums font-semibold', className)}>{value}</div>
    </div>
  );
}

function phaseLabel(phase: string | undefined, open: boolean | undefined): string {
  if (open) return 'OPEN';
  if (phase === 'preopen') return 'PRE-OPEN';
  if (phase === 'postclose') return 'POST';
  return 'CLOSED';
}

function histTimeLabel(t: string | undefined): string {
  if (!t) return '';
  try {
    const d = new Date(t);
    return d.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Riyadh',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return t.slice(11, 16);
  }
}

function KsaDepthCharts({ board }: { board: KsaBoard | null }) {
  const depth = board?.depth;
  const chrome = deskChartChrome();
  const hist = useMemo(
    () =>
      (depth?.history || []).map((p) => ({
        ...p,
        label: histTimeLabel(p.t),
      })),
    [depth?.history],
  );
  const sectors = depth?.sectorBars || [];
  const movers = depth?.moverBars || [];
  const vol = depth?.volLeaders || [];
  const br = depth?.breadth;

  return (
    <div className="grid min-h-0 grid-cols-1 gap-2 xl:grid-cols-2">
      <Panel title="TASI path (warmer samples)">
        <DeskChartFrame height={180} yTitle="Index" xTitle="Riyadh time · free samples only">
          {hist.length < 1 ? (
            <p className="px-2 py-6 font-mono text-type-xs text-muted-foreground">
              {depth?.historyNote || 'Path builds after each warmer board pack (~30m). No extra API cost.'}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hist} margin={chrome.margin}>
                <CartesianGrid {...chrome.grid} />
                <XAxis dataKey="label" tick={chrome.tick} axisLine={{ stroke: chrome.axisLine }} minTickGap={24} />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={chrome.tick}
                  axisLine={{ stroke: chrome.axisLine }}
                  width={48}
                />
                <Tooltip contentStyle={chrome.tooltipStyle} />
                <Area
                  type="monotone"
                  dataKey="tasi"
                  name="TASI"
                  stroke={CHART.series.brand}
                  fill={CHART.series.brand}
                  fillOpacity={0.12}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </DeskChartFrame>
        {hist.length > 0 && (
          <p className="border-t border-border px-2 py-1 font-mono text-type-2xs text-muted-foreground">
            n={hist.length}
            {hist[0] && hist[hist.length - 1] && hist[0].tasi
              ? ` · session Δ ${fmtSigned(
                  ((hist[hist.length - 1]!.tasi - hist[0]!.tasi) / hist[0]!.tasi) * 100,
                  2,
                )}% vs first sample`
              : ''}
            {' · '}
            {depth?.historyNote}
          </p>
        )}
      </Panel>

      <Panel title="Breadth · A/D">
        <div className="grid grid-cols-3 gap-2 px-2 py-2 font-mono text-type-xs">
          <Stat label="Adv" value={br ? String(br.adv) : '—'} className="text-up" />
          <Stat label="Dec" value={br ? String(br.dec) : '—'} className="text-down" />
          <Stat label="Unch" value={br ? String(br.unc) : '—'} />
          <Stat
            label="Breadth"
            value={br?.ratio != null ? fmtSigned(br.ratio, 2) : '—'}
            className={chgClass(br?.ratio)}
          />
          <Stat
            label="Adv share"
            value={br?.advShare != null ? `${(br.advShare * 100).toFixed(0)}%` : '—'}
          />
          <Stat label="Names" value={br ? String(br.total) : '—'} />
        </div>
        <DeskChartFrame height={120} yTitle="Breadth (−1…+1)">
          {hist.filter((p) => p.breadth != null).length < 1 ? (
            <p className="px-2 py-4 font-mono text-type-xs text-muted-foreground">Breadth series after first packs.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hist} margin={chrome.margin}>
                <CartesianGrid {...chrome.grid} />
                <XAxis dataKey="label" tick={chrome.tick} axisLine={{ stroke: chrome.axisLine }} minTickGap={28} />
                <YAxis domain={[-1, 1]} tick={chrome.tick} axisLine={{ stroke: chrome.axisLine }} width={32} />
                <ReferenceLine y={0} stroke={CHART.refLine} />
                <Tooltip contentStyle={chrome.tooltipStyle} />
                <Area
                  type="monotone"
                  dataKey="breadth"
                  name="Breadth"
                  stroke={CHART.series.info}
                  fill={CHART.series.info}
                  fillOpacity={0.1}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </DeskChartFrame>
      </Panel>

      <Panel title="Sectors (TASI % day)">
        <DeskChartFrame height={200} yTitle="%">
          {sectors.length === 0 ? (
            <p className="px-2 py-6 font-mono text-type-xs text-muted-foreground">No sector rows on pack.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sectors} layout="vertical" margin={{ ...chrome.margin, left: 8 }}>
                <CartesianGrid {...chrome.grid} horizontal={false} />
                <XAxis type="number" tick={chrome.tick} axisLine={{ stroke: chrome.axisLine }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={88}
                  tick={chrome.tick}
                  axisLine={{ stroke: chrome.axisLine }}
                />
                <ReferenceLine x={0} stroke={CHART.refLine} />
                <Tooltip contentStyle={chrome.tooltipStyle} />
                <Bar dataKey="pct" name="%" isAnimationActive={false} radius={[0, 2, 2, 0]}>
                  {sectors.map((s) => (
                    <Cell key={s.name} fill={s.pct >= 0 ? CHART.series.up : CHART.series.down} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </DeskChartFrame>
      </Panel>

      <Panel title="Movers & volume leaders">
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          <DeskChartFrame height={160} yTitle="Mover %">
            {movers.length === 0 ? (
              <p className="px-2 py-4 font-mono text-type-xs text-muted-foreground">No movers.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={movers.slice(0, 12)} margin={chrome.margin}>
                  <CartesianGrid {...chrome.grid} />
                  <XAxis dataKey="symbol" tick={chrome.tick} axisLine={{ stroke: chrome.axisLine }} interval={0} angle={-35} textAnchor="end" height={40} />
                  <YAxis tick={chrome.tick} axisLine={{ stroke: chrome.axisLine }} width={32} />
                  <ReferenceLine y={0} stroke={CHART.refLine} />
                  <Tooltip contentStyle={chrome.tooltipStyle} />
                  <Bar dataKey="pct" name="%" isAnimationActive={false}>
                    {movers.slice(0, 12).map((m) => (
                      <Cell key={m.symbol} fill={m.pct >= 0 ? CHART.series.up : CHART.series.down} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </DeskChartFrame>
          <DeskChartFrame height={160} yTitle="Volume">
            {vol.length === 0 ? (
              <p className="px-2 py-4 font-mono text-type-xs text-muted-foreground">No volume leaders.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={vol} margin={chrome.margin}>
                  <CartesianGrid {...chrome.grid} />
                  <XAxis dataKey="symbol" tick={chrome.tick} axisLine={{ stroke: chrome.axisLine }} interval={0} angle={-35} textAnchor="end" height={40} />
                  <YAxis tick={chrome.tick} axisLine={{ stroke: chrome.axisLine }} width={40} tickFormatter={(v) => fmtCompact(Number(v))} />
                  <Tooltip contentStyle={chrome.tooltipStyle} formatter={(v: number) => fmtCompact(v)} />
                  <Bar dataKey="volume" name="Vol" fill={CHART.series.info} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </DeskChartFrame>
        </div>
      </Panel>
    </div>
  );
}

export function KsaMarketView() {
  const [board, setBoard] = useState<KsaBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [focusSym, setFocusSym] = useState('2222');
  const [focusQuote, setFocusQuote] = useState<KsaQuote | null>(null);
  const [localSession] = useState(() => riyadhSessionSnapshot());

  const load = useCallback(async () => {
    try {
      const b = await fetchKsaBoardClient();
      setBoard(b);
    } catch (e) {
      setBoard({
        error: e instanceof Error ? e.message : 'Board fetch failed',
        session: riyadhSessionSnapshot(),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), KSA_BOARD_POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  // Focus from shared board only (free tier — no per-symbol SAHMK /quote on free path).
  useEffect(() => {
    const fromBoard = findFocusOnBoard(board, focusSym);
    if (fromBoard) {
      setFocusQuote(fromBoard as KsaQuote);
    } else {
      setFocusQuote(null);
    }
  }, [board, focusSym]);

  const session = board?.session ?? localSession;
  const focus = focusQuote ?? findFocusOnBoard(board, focusSym);

  const freshnessKind =
    board?.configured === false
      ? 'down'
      : board?.error && board.tasi?.index_value == null && !board.stale
        ? 'down'
        : board?.stale
          ? 'stale'
          : board?.is_delayed !== false
            ? 'delayed'
            : 'live';

  if (loading && !board) {
    return <EmptyState kind="loading" title="Loading KSA board…" body="Shared SAHMK cache · Riyadh session" />;
  }

  return (
    <SectionErrorBoundary name="KSA Market">
      <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto p-2" data-testid="ksa-view">
        {/* Session strip */}
        <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-card/40 px-2 py-1.5 font-mono text-type-xs">
          <span className="font-semibold tracking-wide">KSA · TADAWUL</span>
          <span
            className={cn(
              'rounded border px-1.5 py-0.5 font-semibold',
              session.open
                ? 'border-up/40 bg-up/10 text-up'
                : 'border-muted-foreground/30 text-muted-foreground',
            )}
          >
            {phaseLabel(session.phase, session.open)}
          </span>
          <span className="text-muted-foreground">
            {session.local} {session.timezone} · {session.weekday}
          </span>
          <FreshnessChip kind={freshnessKind} title={board?.data_mode || 'delayed'} />
          <span className="text-muted-foreground">
            {board?.fromCache ? 'cache' : 'net'}
            {board?.ageMs != null ? ` · ${Math.round(board.ageMs / 1000)}s` : ''}
          </span>
          {board?.budget && (
            <span className="text-muted-foreground">
              SAHMK {board.budget.used ?? '—'}/{board.budget.capDaily ?? 100}/day
            </span>
          )}
          <button
            type="button"
            className="ml-auto rounded border border-border px-2 py-0.5 hover:bg-secondary"
            onClick={() => {
              setLoading(true);
              void load();
            }}
          >
            Refresh
          </button>
        </div>

        {board?.configured === false && (
          <EmptyState
            kind="api-down"
            title="SAHMK not configured"
            body={board.hint || 'Set SAHMK_API_KEY on the server (.env). Free: 100 req/day delayed. Key stays server-side.'}
          />
        )}

        {board?.error && board.configured !== false && board.tasi?.index_value == null && !board.stale && (
          <EmptyState
            kind="error"
            title={board.code === 'BUDGET' ? 'SAHMK budget exhausted' : 'Board error'}
            body={board.error}
          />
        )}
        {board?.stale && board.error && board.tasi?.index_value != null && (
          <div className="rounded border border-amber/40 bg-amber/10 px-2 py-1 font-mono text-type-2xs text-amber">
            Showing last good board · refresh failed: {board.error}
          </div>
        )}

        {/* Indices */}
        <div className="flex flex-wrap gap-2">
          <IndexCard
            label="TASI (Main)"
            value={board?.tasi?.index_value}
            change={board?.tasi?.index_change}
            changePct={board?.tasi?.index_change_percent}
            volume={board?.tasi?.total_volume}
            mood={board?.tasi?.market_mood}
            adv={board?.tasi?.advancing}
            dec={board?.tasi?.declining}
          />
          <IndexCard
            label="Nomu (Parallel)"
            value={board?.nomu?.index_value}
            change={board?.nomu?.index_change}
            changePct={board?.nomu?.index_change_percent}
            volume={board?.nomu?.total_volume}
          />
          <div className="min-w-[180px] flex-1 rounded border border-border bg-card/40 px-2.5 py-2 font-mono text-type-2xs text-muted-foreground">
            <div className="mb-1 text-type-xs text-foreground">Desk notes</div>
            <ul className="list-inside list-disc space-y-0.5">
              <li>Currency SAR · USD peg ~3.75</li>
              <li>Week Sun–Thu · T+2 settlement</li>
              <li>Free feed is delayed (~15m)</li>
              <li>Derivatives thin — catalog later</li>
            </ul>
          </div>
        </div>

        {/* Mega strip */}
        <div className="flex flex-wrap gap-1.5">
          {(board?.mega || []).map((q) => (
            <MegaChip
              key={q.symbol}
              q={q}
              active={focusSym === q.symbol}
              onClick={() => setFocusSym(q.symbol)}
            />
          ))}
        </div>

        <FocusQuote q={focus as KsaQuote | null} />

        {/* Charts — all free from pack + history ring */}
        <KsaDepthCharts board={board} />

        {/* Movers tables — value leaders omitted on free tier (no traded_value field) */}
        <div className="grid min-h-0 grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          <MoverTable title="Gainers" rows={board?.gainers || []} mode="pct" onPick={setFocusSym} />
          <MoverTable title="Losers" rows={board?.losers || []} mode="pct" onPick={setFocusSym} />
          <MoverTable title="Volume" rows={board?.volumeLeaders || []} mode="vol" onPick={setFocusSym} />
        </div>
        {board?.valueLeaders && board.valueLeaders.length > 0 && board.valueLeaders !== board.volumeLeaders && (
          <div className="mt-2">
            <MoverTable title="Value" rows={board.valueLeaders} mode="val" onPick={setFocusSym} />
          </div>
        )}

        <Panel title="Market map · depth notes">
          <div className="space-y-1 px-2 py-2 font-mono text-type-2xs text-muted-foreground">
            <p>
              <strong className="text-foreground">Saudi Exchange (Tadawul)</strong> — Main (TASI) + Nomu ·
              Muqassa · Edaa · CMA · SAR · Sun–Thu · T+2 · delayed free feed.
            </p>
            <p>
              <strong className="text-foreground">Free depth (this tab)</strong> — one 6-call warmer pack → indices,
              sectors, movers, volume, mega strip, breadth + TASI path ring. Charts cost <em>zero</em> extra SAHMK.
            </p>
            <p>
              <strong className="text-foreground">Paid depth (later)</strong> — SAHMK Starter/Pro for OHLCV history,
              batch quotes, financials, real-time WS. Not on free 100/day path.
            </p>
            <p>
              Codes: <span className="text-info">KSA</span> / <span className="text-info">TASI</span> /{' '}
              <span className="text-info">TADAWUL</span>.
            </p>
          </div>
        </Panel>
      </div>
    </SectionErrorBoundary>
  );
}
