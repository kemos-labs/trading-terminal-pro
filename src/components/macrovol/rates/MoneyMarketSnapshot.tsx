/**
 * Funding desk board — single surface for ON rates / corridor / liquidity / basis path.
 *
 * Pro pattern (BTMM / NYFed ref rates / Conks hierarchy): dense prints first,
 * then a few purposeful charts — not stacked mini-dashboards of the same series.
 * Data: FRED + NY Fed (live). Fail-closed empties.
 */
import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  RatesSummary,
  PlumbingData,
  BasisData,
  BasisHistoryData,
  StirStripData,
} from '../../../lib/macrovol/api';
import { CollapsibleSection } from '../../terminal/CollapsibleSection';
import { DeskChartFrame, deskChartChrome } from '../../desk/DeskChart';
import { DataBadge } from '../DataBadge';
import { CHART, tightDomain } from '../../../lib/chartTheme';
import { cn } from '../../../lib/utils';

type CurvePt = { label: string; yield: number | null };

function fmtPct(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(d)}%`;
}

function fmtBps(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = v > 0 ? '+' : '';
  return `${s}${v.toFixed(1)}bp`;
}

function fmtBn(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(2)}T`;
  return `${v.toFixed(1)}bn`;
}

function nyRate(ny: StirStripData['nyfed'] | undefined, code: string): number | null {
  const row = ny?.ref_print?.find((r) => r.code === code);
  return row?.rate != null && Number.isFinite(row.rate) ? row.rate : null;
}

function nyVol(ny: StirStripData['nyfed'] | undefined, code: string): number | null {
  const row = ny?.ref_print?.find((r) => r.code === code);
  return row?.volume_bn != null && Number.isFinite(row.volume_bn) ? row.volume_bn : null;
}

function nyPct(ny: StirStripData['nyfed'] | undefined, code: string) {
  const row = ny?.ref_print?.find((r) => r.code === code);
  if (!row) return null;
  return {
    p1: row.p1 ?? null,
    p25: row.p25 ?? null,
    p75: row.p75 ?? null,
    p99: row.p99 ?? null,
    rate: row.rate ?? null,
  };
}

function pickCurve(curve: CurvePt[], ...labels: string[]): number | null {
  for (const lab of labels) {
    const hit = curve.find((c) => c.label === lab || c.label.toUpperCase() === lab.toUpperCase());
    if (hit?.yield != null && Number.isFinite(hit.yield)) return hit.yield;
  }
  return null;
}

function PrintRow({
  label,
  value,
  sub,
  emphasize,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-2 border-b border-border/40 px-1.5 py-1 font-mono last:border-0',
        emphasize && 'bg-primary/5',
      )}
    >
      <div className="min-w-0">
        <div className={cn('text-type-2xs', emphasize ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
          {label}
        </div>
        {sub && <div className="truncate text-type-2xs text-muted-foreground/80">{sub}</div>}
      </div>
      <div className={cn('shrink-0 tabular-nums font-semibold', emphasize ? 'text-base' : 'text-sm')}>
        {value}
      </div>
    </div>
  );
}

export function MoneyMarketSnapshot({
  summary,
  plumbing,
  basis,
  basisHist,
  stir,
  curve,
}: {
  summary: RatesSummary | null;
  plumbing: PlumbingData | null;
  basis: BasisData | null;
  basisHist: BasisHistoryData | null;
  stir: StirStripData | null;
  curve: CurvePt[];
}) {
  const chrome = deskChartChrome();
  const ny = stir?.nyfed;

  const sofr =
    basis?.sofr ?? plumbing?.sofr ?? summary?.sofr ?? nyRate(ny, 'SOFR');
  const effr =
    basis?.effr ?? plumbing?.effr ?? summary?.effr ?? nyRate(ny, 'EFFR');
  const iorb = basis?.iorb ?? plumbing?.iorb ?? null;
  const obfr = nyRate(ny, 'OBFR');
  const tgcr = nyRate(ny, 'TGCR');
  const bgcr = nyRate(ny, 'BGCR');
  const rrpRate = plumbing?.rrp_rate ?? (iorb != null ? Math.round((iorb - 0.1) * 100) / 100 : null);
  const srpRate = iorb != null ? Math.round((iorb + 0.1) * 100) / 100 : null;

  const bill1m = pickCurve(curve, '1M', '1m', '1MO');
  const bill3m = pickCurve(curve, '3M', '3m', '3MO');
  const bill6m = pickCurve(curve, '6M', '6m', '6MO');
  const bill1y = pickCurve(curve, '1Y', '1y', '1YR', '12M');

  const billsChart = useMemo(
    () =>
      [
        { tenor: '1M', y: bill1m },
        { tenor: '3M', y: bill3m },
        { tenor: '6M', y: bill6m },
        { tenor: '1Y', y: bill1y },
      ].filter((r) => r.y != null),
    [bill1m, bill3m, bill6m, bill1y],
  );

  const corridorChart = useMemo(() => {
    return [
      { name: 'RRP', rate: rrpRate, role: 'floor' },
      { name: 'IORB', rate: iorb, role: 'reserves' },
      { name: 'SOFR', rate: sofr, role: 'secured' },
      { name: 'TGCR', rate: tgcr, role: 'secured' },
      { name: 'EFFR', rate: effr, role: 'unsec' },
      { name: 'OBFR', rate: obfr, role: 'euro$' },
      { name: 'SRP*', rate: srpRate, role: 'ceiling' },
    ].filter((r) => r.rate != null);
  }, [rrpRate, iorb, sofr, tgcr, effr, obfr, srpRate]);

  const volBars = useMemo(
    () =>
      [
        { name: 'SOFR', vol: nyVol(ny, 'SOFR') },
        { name: 'TGCR', vol: nyVol(ny, 'TGCR') },
        { name: 'BGCR', vol: nyVol(ny, 'BGCR') },
        { name: 'EFFR', vol: nyVol(ny, 'EFFR') },
        { name: 'OBFR', vol: nyVol(ny, 'OBFR') },
      ].filter((r) => r.vol != null),
    [ny],
  );

  const sofrDist = nyPct(ny, 'SOFR');
  const effrDist = nyPct(ny, 'EFFR');

  const rrpHist = useMemo(
    () =>
      (plumbing?.rrp_volume_history || []).slice(-60).map((r) => ({
        date: r.date.slice(5),
        volume: r.volume,
      })),
    [plumbing?.rrp_volume_history],
  );

  const resHist = useMemo(
    () =>
      (plumbing?.wresbal_history || []).slice(-90).map((r) => ({
        date: r.date.slice(5),
        reservesBn: r.reserves / 1000,
      })),
    [plumbing?.wresbal_history],
  );

  const spreadHist = useMemo(
    () =>
      (basisHist?.history || []).slice(-60).map((h) => ({
        date: h.date.slice(5),
        sofrEffr: h.sofr_effr_bps,
        sofrIorb: h.sofr_iorb_bps,
        effrIorb: h.effr_iorb_bps,
      })),
    [basisHist?.history],
  );

  const levelHist = useMemo(
    () =>
      (basisHist?.history || []).slice(-60).map((h) => ({
        date: h.date.slice(5),
        sofr: h.sofr,
        effr: h.effr,
        iorb: h.iorb,
      })),
    [basisHist?.history],
  );

  const serff = useMemo(() => {
    if (stir?.serff_board?.length) {
      return stir.serff_board
        .slice(0, 8)
        .map((r) => ({
          label: r.cc || r.name || '—',
          bps: r.last_bps ?? null,
        }))
        .filter((r) => r.bps != null);
    }
    const byKind = stir?.spreads?.by_kind?.serff || [];
    const all = byKind.length
      ? byKind
      : (stir?.spreads?.spreads || []).filter((s) => s.kind === 'serff');
    return all
      .slice(0, 8)
      .map((r) => ({
        label: r.name,
        bps: r.rate_bps,
      }))
      .filter((r) => r.bps != null);
  }, [stir?.serff_board, stir?.spreads]);

  const levelY = tightDomain(
    levelHist.flatMap((r) => [r.sofr, r.effr, r.iorb]),
    0.12,
    { minPadAbs: 0.02 },
  );
  const spreadY = tightDomain(
    spreadHist.flatMap((r) => [r.sofrEffr, r.sofrIorb, r.effrIorb]),
    0.15,
    { includeZero: true, minPadAbs: 1 },
  );
  const rrpY = tightDomain(rrpHist.map((d) => d.volume), 0.1, { minPadAbs: 5 });
  const resY = tightDomain(resHist.map((d) => d.reservesBn), 0.1, { minPadAbs: 5 });

  const sofrEffrBps =
    basis?.sofr_effr ?? (sofr != null && effr != null ? (sofr - effr) * 100 : null);
  const sofrIorbBps =
    basis?.sofr_iorb ?? (sofr != null && iorb != null ? (sofr - iorb) * 100 : null);
  const effrIorbBps =
    basis?.effr_iorb ?? (effr != null && iorb != null ? (effr - iorb) * 100 : null);
  const iorbEffrBps =
    iorb != null && effr != null ? (iorb - effr) * 100 : null;

  const asOf =
    basis?.as_of || plumbing?.as_of || summary?.as_of || ny?.as_of || null;
  const printSofr = basis?.obs_dates?.SOFR || summary?.obs_dates?.SOFR;
  const printEffr = basis?.obs_dates?.DFF || basis?.obs_dates?.EFFR;
  const reservesBn =
    plumbing?.wresbal_history?.length
      ? (plumbing.wresbal_history[plumbing.wresbal_history.length - 1]?.reserves ?? 0) / 1000
      : null;

  const regime = basis?.regime;
  const z = basisHist?.zscore;

  return (
    <CollapsibleSection
      id="sec-mm-snapshot"
      title="MONEY MARKETS · FUNDING BOARD"
      apis={['FRED', 'NYFed']}
      defaultOpen
      storageKey="rates.sec.mm-snapshot"
      subtitle="BTMM-style: prints → corridor → path → liquidity · one surface (no duplicate strips)"
      badge={
        regime ? (
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-type-2xs font-bold uppercase',
              regime === 'corridor_normal' && 'bg-up/15 text-up',
              regime === 'above_floor' && 'bg-warn/15 text-warn',
              regime === 'wide_discount' && 'bg-down/15 text-down',
            )}
          >
            {regime.replace(/_/g, ' ')}
          </span>
        ) : (
          <span className="rounded bg-info/15 px-1.5 py-0.5 text-type-2xs font-bold text-info">
            LIVE
          </span>
        )
      }
    >
      {/* ── 1. Dense quote strips (Conks sections as tables, not 6 hero cards) ── */}
      <div id="sec-mm-strip" className="grid min-h-0 grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded border border-border bg-card/40">
          <div className="border-b border-border px-2 py-1 font-mono text-type-2xs font-semibold tracking-wide text-muted-foreground">
            SECURED
          </div>
          <PrintRow label="SOFR" value={fmtPct(sofr)} sub="o/n Tsy repo avg" emphasize />
          <PrintRow label="TGCR" value={fmtPct(tgcr)} sub="triparty" />
          <PrintRow label="BGCR" value={fmtPct(bgcr)} sub="TGCR + interdealer" />
          <PrintRow
            label="Range SOFR"
            value={
              sofrDist?.p25 != null && sofrDist?.p75 != null
                ? `${sofrDist.p25.toFixed(2)}–${sofrDist.p75.toFixed(2)}`
                : '—'
            }
            sub="25th–75th"
          />
          <PrintRow label="Vol SOFR" value={fmtBn(nyVol(ny, 'SOFR'))} sub="$bn" />
        </div>

        <div className="rounded border border-border bg-card/40">
          <div className="border-b border-border px-2 py-1 font-mono text-type-2xs font-semibold tracking-wide text-muted-foreground">
            UNSECURED
          </div>
          <PrintRow label="EFFR" value={fmtPct(effr)} sub="fed funds effective" emphasize />
          <PrintRow label="OBFR" value={fmtPct(obfr)} sub="broad / euro$" />
          <PrintRow
            label="Range EFFR"
            value={
              effrDist?.p25 != null && effrDist?.p75 != null
                ? `${effrDist.p25.toFixed(2)}–${effrDist.p75.toFixed(2)}`
                : '—'
            }
            sub="25th–75th"
          />
          <PrintRow label="Vol EFFR" value={fmtBn(nyVol(ny, 'EFFR'))} sub="$bn" />
          <PrintRow label="Vol OBFR" value={fmtBn(nyVol(ny, 'OBFR'))} sub="$bn" />
        </div>

        <div className="rounded border border-border bg-card/40">
          <div className="border-b border-border px-2 py-1 font-mono text-type-2xs font-semibold tracking-wide text-muted-foreground">
            ADMIN · CORRIDOR
          </div>
          <PrintRow label="IORB" value={fmtPct(iorb)} sub="interest on reserves" emphasize />
          <PrintRow
            label="RRP offer"
            value={fmtPct(rrpRate)}
            sub={plumbing?.rrp_rate_source || plumbing?.rrp_rate_note || 'floor'}
          />
          <PrintRow label="SRP*" value={fmtPct(srpRate)} sub="IORB+10bp convention" />
          <PrintRow label="RRP take" value={fmtBn(plumbing?.rrp_volume_latest)} sub="o/n $bn" />
          <PrintRow label="Reserves" value={fmtBn(reservesBn)} sub="WRESBAL $bn" />
        </div>

        <div id="sec-basis" className="rounded border border-border bg-card/40">
          <div className="border-b border-border px-2 py-1 font-mono text-type-2xs font-semibold tracking-wide text-muted-foreground">
            SPREADS · Z
          </div>
          <PrintRow label="SOFR−EFFR" value={fmtBps(sofrEffrBps)} sub={basis?.context?.sofr_effr} emphasize />
          <PrintRow label="SOFR−IORB" value={fmtBps(sofrIorbBps)} sub={basis?.context?.sofr_iorb} />
          <PrintRow label="EFFR−IORB" value={fmtBps(effrIorbBps)} sub={basis?.context?.effr_iorb} />
          <PrintRow label="IORB−EFFR" value={fmtBps(iorbEffrBps)} sub="arb window" />
          {z && (
            <PrintRow
              label={`Z ${z.window}d SOFR−EFFR`}
              value={z.sofr_effr != null ? z.sofr_effr.toFixed(2) : '—'}
              sub={Math.abs(z.sofr_effr ?? 0) > 2 ? 'elevated' : 'in range'}
            />
          )}
        </div>
      </div>

      {basis?.regime_note && (
        <p className="mt-1.5 font-mono text-type-2xs leading-snug text-muted-foreground">
          {basis.regime_note}
        </p>
      )}

      {/* ── 2. Corridor + bills (one glance structure) ── */}
      <div className="mt-2 grid min-h-0 grid-cols-1 gap-2 xl:grid-cols-2">
        <div className="rounded border border-border bg-black/40">
          <div className="border-b border-border px-2 py-1 font-mono text-type-2xs text-muted-foreground">
            CORRIDOR MAP — floor · market · ceiling
          </div>
          <DeskChartFrame height={168} yTitle="%">
            {corridorChart.length < 2 ? (
              <p className="px-2 py-6 font-mono text-type-xs text-muted-foreground">Need IORB / SOFR / EFFR.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={corridorChart} margin={chrome.margin}>
                  <CartesianGrid {...chrome.grid} />
                  <XAxis dataKey="name" tick={chrome.tick} axisLine={{ stroke: chrome.axisLine }} />
                  <YAxis
                    domain={['auto', 'auto']}
                    tick={chrome.tick}
                    axisLine={{ stroke: chrome.axisLine }}
                    width={36}
                    tickFormatter={(v) => Number(v).toFixed(2)}
                  />
                  <Tooltip contentStyle={chrome.tooltipStyle} />
                  <Bar dataKey="rate" name="%" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                    {corridorChart.map((r) => (
                      <Cell
                        key={r.name}
                        fill={
                          r.name === 'SOFR' || r.name === 'TGCR'
                            ? CHART.series.brand
                            : r.name === 'RRP' || r.name === 'SRP*'
                              ? CHART.series.muted
                              : r.name === 'IORB'
                                ? CHART.series.warn
                                : CHART.series.info
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </DeskChartFrame>
        </div>

        <div className="rounded border border-border bg-black/40">
          <div className="border-b border-border px-2 py-1 font-mono text-type-2xs text-muted-foreground">
            BILLS — CMT short end (DGS1MO…1Y)
          </div>
          <DeskChartFrame height={168} yTitle="%">
            {billsChart.length < 2 ? (
              <p className="px-2 py-6 font-mono text-type-xs text-muted-foreground">Curve short end unavailable.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={billsChart} margin={chrome.margin}>
                  <CartesianGrid {...chrome.grid} />
                  <XAxis dataKey="tenor" tick={chrome.tick} axisLine={{ stroke: chrome.axisLine }} />
                  <YAxis
                    domain={['auto', 'auto']}
                    tick={chrome.tick}
                    axisLine={{ stroke: chrome.axisLine }}
                    width={36}
                    tickFormatter={(v) => Number(v).toFixed(2)}
                  />
                  <Tooltip contentStyle={chrome.tooltipStyle} />
                  <Bar dataKey="y" name="Yield %" fill={CHART.series.brand} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                  <Line type="monotone" dataKey="y" stroke={CHART.series.info} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </DeskChartFrame>
          <div className="grid grid-cols-4 gap-1 border-t border-border px-2 py-1 font-mono text-type-2xs">
            {(
              [
                ['1M', bill1m],
                ['3M', bill3m],
                ['6M', bill6m],
                ['1Y', bill1y],
              ] as const
            ).map(([lab, v]) => (
              <div key={lab}>
                <span className="text-muted-foreground">{lab}</span>{' '}
                <span className="tabular-nums font-semibold">{fmtPct(v)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 3. Path: levels + spreads (once) ── */}
      <div className="mt-2 grid min-h-0 grid-cols-1 gap-2 xl:grid-cols-2">
        <div className="rounded border border-border bg-black/40">
          <div className="border-b border-border px-2 py-1 font-mono text-type-2xs text-muted-foreground">
            LEVELS — SOFR · EFFR · IORB (tight scale)
          </div>
          <DeskChartFrame height={180} yTitle="%">
            {levelHist.length < 5 ? (
              <p className="px-2 py-6 font-mono text-type-xs text-muted-foreground">History loading…</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={levelHist} margin={chrome.margin}>
                  <CartesianGrid {...chrome.grid} />
                  <XAxis dataKey="date" tick={chrome.tick} axisLine={{ stroke: chrome.axisLine }} minTickGap={24} />
                  <YAxis domain={levelY} tick={chrome.tick} axisLine={{ stroke: chrome.axisLine }} width={36} />
                  <Tooltip contentStyle={chrome.tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="sofr" name="SOFR" stroke={CHART.series.brand} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="effr" name="EFFR" stroke={CHART.series.info} strokeWidth={1.2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="iorb" name="IORB" stroke={CHART.series.warn} strokeWidth={1.2} strokeDasharray="3 2" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </DeskChartFrame>
        </div>

        <div className="rounded border border-border bg-black/40">
          <div className="border-b border-border px-2 py-1 font-mono text-type-2xs text-muted-foreground">
            SPREADS (bp) — SOFR−EFFR · SOFR−IORB · EFFR−IORB
          </div>
          <DeskChartFrame height={180} yTitle="bp">
            {spreadHist.length < 5 ? (
              <p className="px-2 py-6 font-mono text-type-xs text-muted-foreground">Spread history empty.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={spreadHist} margin={chrome.margin}>
                  <CartesianGrid {...chrome.grid} />
                  <XAxis dataKey="date" tick={chrome.tick} axisLine={{ stroke: chrome.axisLine }} minTickGap={24} />
                  <YAxis domain={spreadY} tick={chrome.tick} axisLine={{ stroke: chrome.axisLine }} width={36} />
                  <ReferenceLine y={0} stroke={CHART.refLine} />
                  <Tooltip contentStyle={chrome.tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line type="monotone" dataKey="sofrEffr" name="SOFR−EFFR" stroke={CHART.series.brand} strokeWidth={1.3} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="sofrIorb" name="SOFR−IORB" stroke={CHART.series.warn} strokeWidth={1.3} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="effrIorb" name="EFFR−IORB" stroke={CHART.series.info} strokeWidth={1.2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </DeskChartFrame>
        </div>
      </div>

      {/* ── 4. Liquidity + volume (plumbing, once) ── */}
      <div id="sec-plumbing" className="mt-2 grid min-h-0 grid-cols-1 gap-2 xl:grid-cols-3">
        <div className="rounded border border-border bg-black/40">
          <div className="border-b border-border px-2 py-1 font-mono text-type-2xs text-muted-foreground">
            RRP VOLUME ($bn) · o/n take
          </div>
          <DeskChartFrame height={150} yTitle="$bn">
            {rrpHist.length < 5 ? (
              <p className="px-2 py-6 font-mono text-type-xs text-muted-foreground">RRP history empty.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={rrpHist} margin={chrome.margin}>
                  <CartesianGrid {...chrome.grid} />
                  <XAxis dataKey="date" tick={chrome.tick} axisLine={{ stroke: chrome.axisLine }} minTickGap={28} />
                  <YAxis domain={rrpY} tick={chrome.tick} axisLine={{ stroke: chrome.axisLine }} width={40} />
                  <Tooltip contentStyle={chrome.tooltipStyle} />
                  <Area
                    type="monotone"
                    dataKey="volume"
                    name="RRP $bn"
                    stroke={CHART.series.warn}
                    fill={CHART.series.warn}
                    fillOpacity={0.15}
                    strokeWidth={1.5}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </DeskChartFrame>
        </div>

        <div className="rounded border border-border bg-black/40">
          <div className="border-b border-border px-2 py-1 font-mono text-type-2xs text-muted-foreground">
            RESERVES (WRESBAL · $bn)
          </div>
          <DeskChartFrame height={150} yTitle="$bn">
            {resHist.length < 5 ? (
              <p className="px-2 py-6 font-mono text-type-xs text-muted-foreground">Reserves history empty.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={resHist} margin={chrome.margin}>
                  <CartesianGrid {...chrome.grid} />
                  <XAxis dataKey="date" tick={chrome.tick} axisLine={{ stroke: chrome.axisLine }} minTickGap={28} />
                  <YAxis domain={resY} tick={chrome.tick} axisLine={{ stroke: chrome.axisLine }} width={44} />
                  <Tooltip contentStyle={chrome.tooltipStyle} />
                  <Area
                    type="monotone"
                    dataKey="reservesBn"
                    name="Reserves $bn"
                    stroke={CHART.series.info}
                    fill={CHART.series.info}
                    fillOpacity={0.12}
                    strokeWidth={1.5}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </DeskChartFrame>
        </div>

        <div className="rounded border border-border bg-black/40">
          <div className="border-b border-border px-2 py-1 font-mono text-type-2xs text-muted-foreground">
            BENCHMARK VOLUMES (NY Fed · $bn)
          </div>
          <DeskChartFrame height={150} yTitle="$bn">
            {volBars.length < 1 ? (
              <p className="px-2 py-6 font-mono text-type-xs text-muted-foreground">
                Volumes after NY Fed ref pack loads.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={volBars} margin={chrome.margin}>
                  <CartesianGrid {...chrome.grid} />
                  <XAxis dataKey="name" tick={chrome.tick} axisLine={{ stroke: chrome.axisLine }} />
                  <YAxis tick={chrome.tick} axisLine={{ stroke: chrome.axisLine }} width={40} />
                  <Tooltip contentStyle={chrome.tooltipStyle} />
                  <Bar dataKey="vol" name="$bn" fill={CHART.series.info} isAnimationActive={false} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </DeskChartFrame>
        </div>
      </div>

      {/* ── 5. SERFF only if strip is warm (else STIR mode owns it) ── */}
      {serff.length > 0 && (
        <div className="mt-2 rounded border border-border bg-black/40">
          <div className="border-b border-border px-2 py-1 font-mono text-type-2xs text-muted-foreground">
            BASIS MARKETS — SOFR−FF / SERFF (from STIR strip)
          </div>
          <DeskChartFrame height={140} yTitle="bp">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={serff} margin={chrome.margin}>
                <CartesianGrid {...chrome.grid} />
                <XAxis
                  dataKey="label"
                  tick={chrome.tick}
                  axisLine={{ stroke: chrome.axisLine }}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={44}
                />
                <YAxis tick={chrome.tick} axisLine={{ stroke: chrome.axisLine }} width={32} />
                <ReferenceLine y={0} stroke={CHART.refLine} />
                <Tooltip contentStyle={chrome.tooltipStyle} />
                <Bar dataKey="bps" name="bp" isAnimationActive={false}>
                  {serff.map((r) => (
                    <Cell key={r.label} fill={(r.bps ?? 0) >= 0 ? CHART.series.up : CHART.series.down} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </DeskChartFrame>
        </div>
      )}

      <DataBadge
        asOf={asOf}
        source={basis?.source || plumbing?.source || ny?.source || 'FRED · NYFed'}
        note={[
          printSofr ? `SOFR print ${printSofr}` : null,
          printEffr ? `EFFR print ${printEffr}` : null,
          'SRP* = IORB+10bp desk convention · free path omits TGA target, OFR DVP/GCF splits, DTCC fails, CP stock',
        ]
          .filter(Boolean)
          .join(' · ')}
        staleThresholdMin={120}
        className="mt-2"
      />
    </CollapsibleSection>
  );
}
