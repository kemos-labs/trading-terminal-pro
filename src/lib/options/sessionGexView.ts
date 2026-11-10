/**
 * Session GEX view model — strike × browser-sample-time matrix (OI proxy, session-delimited).
 *
 * Pure reshape of observed `GexSessionSeries` sparse profiles into heatmap rows/cols/cells.
 * No fetch, no polling, no pricing math, no interpolation: missing stays null (never 0).
 * Session samples are stored OI-weighted by `GexLevelsStrip`; only GEX/Charm profiles exist.
 */
import type { DealerMetric } from './analytics';
import type { GexSessionPoint, GexSessionSeries } from './gexSession';
import type { HeatmapAxisKey, HeatmapCellData } from '../../components/charts/HeatmapEngine';

/** Session stores sparse profiles for GEX + Charm only — DEX/VEX have no stored history. */
export function sessionMetricSupported(metric: DealerMetric): boolean {
  return metric === 'gex' || metric === 'charm';
}

export interface SessionGexMatrix {
  strikes: number[];
  times: number[];
  rows: HeatmapAxisKey[];
  cols: HeatmapAxisKey[];
  /** cells[rowStrike][colTime], $ exposure (raw dollars); null = missing hole, never zero-fill. */
  cells: HeatmapCellData[][];
  withMetric: number;
  totalStrikes: number;
  spot: number | null;
  flip: number | null;
  supported: boolean;
}

/** Finite-or-null guard: NaN/Infinity/non-numbers become null holes. Zero is valid. */
export function finiteOrNull(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Browser-local sample clock label — explicitly NOT provider event time. */
export function sessionTimeLabel(t: number): string {
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function profileOf(pt: GexSessionPoint, metric: DealerMetric) {
  return metric === 'charm' ? pt.charmProfile : pt.profile;
}

function strikeLabel(k: number): string {
  return k >= 1000 ? String(Math.round(k)) : k.toFixed(k % 1 === 0 ? 0 : 1);
}

/**
 * Build the strike × time matrix. Returns null when there is no session history
 * (null series or < 2 samples — heat needs a time dimension, never mocked).
 * Unsupported metrics (dex/vex) return `supported: false` with empty geometry.
 */
export function buildSessionGexMatrix(
  series: GexSessionSeries | null | undefined,
  metric: DealerMetric,
): SessionGexMatrix | null {
  if (!series || !Array.isArray(series.points) || series.points.length < 2) return null;
  const pts = series.points;
  const last = pts[pts.length - 1]!;
  const times = pts.map((p) => p.t);
  const cols: HeatmapAxisKey[] = pts.map((p, i) => ({
    key: `${p.t}#${i}`,
    label: sessionTimeLabel(p.t),
    num: p.t,
  }));
  const base = {
    times,
    cols,
    spot: finiteOrNull(last.spot),
    flip: finiteOrNull(last.flip),
  };
  if (!sessionMetricSupported(metric)) {
    return {
      ...base, strikes: [], rows: [], cells: [],
      withMetric: 0, totalStrikes: 0, supported: false,
    };
  }
  const strikeSet = new Set<number>();
  for (const p of pts) {
    for (const s of profileOf(p, metric) ?? []) {
      if (typeof s?.k === 'number' && Number.isFinite(s.k)) strikeSet.add(s.k);
    }
  }
  const strikes = [...strikeSet].sort((a, b) => a - b).slice(0, 64);
  const rows: HeatmapAxisKey[] = strikes.map((k) => ({
    key: String(k),
    label: strikeLabel(k),
    num: k,
  }));
  const cells: HeatmapCellData[][] = strikes.map((k) => pts.map((p) => {
    const hit = (profileOf(p, metric) ?? []).find((s) => s.k === k);
    const v = finiteOrNull(hit?.g);
    return {
      value: v,
      source: 'browser session sample (derived from OI, model dealer convention)',
      asOf: p.t,
      assumption: 'OI-weighted exposure proxy (not observed dealer inventory).',
    };
  }));
  const withMetric = strikes.filter((_, ri) => cells[ri]!.some((c) => c.value != null)).length;
  return {
    ...base,
    strikes,
    rows,
    cells,
    withMetric,
    totalStrikes: strikes.length,
    supported: true,
  };
}
