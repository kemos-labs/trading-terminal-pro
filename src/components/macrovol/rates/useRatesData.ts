import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  macrovolApi,
  type CacheMeta,
  type RatesSummary,
  type PlumbingData,
  type RatesCurve,
  type RatesCurveHistory,
  type CorrelationData,
  type BasisData,
  type BasisHistoryData,
  type StirStripData,
  type CurveShapeData,
} from '../../../lib/macrovol/api';
import { perfMark, perfMeasure } from '../../../config/perfBudget';
import type { CurveCompareWindowId } from './YieldCurveCompare';

/** Map chip id (+ custom days) → API `periods` query. */
export function periodsParamForWindow(
  windowId: CurveCompareWindowId | string,
  customDays: number,
): string {
  if (windowId === 'custom') {
    const d = Math.max(7, Math.min(800, Math.round(customDays) || 45));
    return `${d}d`;
  }
  return windowId || '1Y';
}

/**
 * Rates desk data.
 *
 * Progressive load: FRED core (summary/plumbing/curve/basis) unblocks UI in ~50ms.
 * STIR strip is yfinance-heavy (~10s cold) — never gates first paint.
 * Curve compare window (1M/3M/6M/1Y/custom) re-fetches FRED history only.
 */
export function useRatesData() {
  const [summary, setSummary] = useState<RatesSummary | null>(null);
  const [summaryCache, setSummaryCache] = useState<CacheMeta | null>(null);
  const [plumbing, setPlumbing] = useState<PlumbingData | null>(null);
  const [basis, setBasis] = useState<BasisData | null>(null);
  const [basisHist, setBasisHist] = useState<BasisHistoryData | null>(null);
  const [stir, setStir] = useState<StirStripData | null>(null);
  const [shape, setShape] = useState<CurveShapeData | null>(null);
  const [curve, setCurve] = useState<{ label: string; yield: number | null }[]>([]);
  const [curveMeta, setCurveMeta] = useState<{ as_of?: string; source?: string; note?: string }>({});
  const [curveCompare, setCurveCompare] = useState<RatesCurveHistory | null>(null);
  const [corr, setCorr] = useState<CorrelationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stirLoading, setStirLoading] = useState(true);
  const [compareWindow, setCompareWindow] = useState<CurveCompareWindowId>('1Y');
  const [customDays, setCustomDays] = useState(45);
  const [compareLoading, setCompareLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setStirLoading(true);
    perfMark('rates.load.start');

    // Phase 1 — FRED-only core (Node light-path cache). Unblocks Funding + UST.
    Promise.allSettled([
      macrovolApi.ratesSummary(),
      macrovolApi.ratesPlumbing(),
      macrovolApi.ratesCurve(),
      macrovolApi.ratesBasis(),
      macrovolApi.ratesBasisHistory(90).catch(() => null),
      macrovolApi.ratesShape(60).catch(() => null),
      macrovolApi.correlations(30, '1y').catch(() => null),
    ]).then(([s, p, c, b, bh, sh, cor]) => {
      if (cancelled) return;
      perfMark('rates.core.end');
      perfMeasure('rates.core', 'rates.load.start', 'rates.core.end');
      if (s.status === 'fulfilled') setSummary(s.value);
      if (s.status === 'fulfilled') setSummaryCache(s.value?.cache ?? null);
      if (p.status === 'fulfilled') setPlumbing(p.value);
      if (c.status === 'fulfilled') {
        const res = c.value as RatesCurve;
        setCurve(res.labels.map((label, i) => ({
          label,
          yield: res.yields[i] != null ? Number(Number(res.yields[i]).toFixed(3)) : null,
        })));
        setCurveMeta({ as_of: res.as_of, source: res.source, note: res.note });
      }
      if (b.status === 'fulfilled') setBasis(b.value);
      if (bh.status === 'fulfilled' && bh.value) setBasisHist(bh.value as BasisHistoryData);
      if (sh.status === 'fulfilled' && sh.value) setShape(sh.value as CurveShapeData);
      if (cor.status === 'fulfilled' && cor.value) setCorr(cor.value as CorrelationData);
      const failed = [s, p, c].every((x) => x.status === 'rejected');
      if (failed) {
        setError([s, p, c].find((x) => x.status === 'rejected')?.reason?.message || 'FRED/NYFed rates unavailable');
      }
      setLoading(false);
    });

    // Phase 2 — STIR (yfinance SR3/SR1/ZQ). Slow cold; cached after first hit.
    macrovolApi
      .stirStrip()
      .then((st) => {
        if (!cancelled && st) setStir(st);
      })
      .catch(() => {
        /* STIR optional for funding/ust */
      })
      .finally(() => {
        if (!cancelled) {
          setStirLoading(false);
          perfMark('rates.load.end');
          perfMeasure('rates.load', 'rates.load.start', 'rates.load.end');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Dual-curve compare — refetches when window chips change (no invented points).
  useEffect(() => {
    let cancelled = false;
    const periods = periodsParamForWindow(compareWindow, customDays);
    setCompareLoading(true);
    macrovolApi
      .ratesCurveHistory(periods)
      .then((ch) => {
        if (!cancelled && ch) setCurveCompare(ch as RatesCurveHistory);
      })
      .catch(() => {
        /* keep prior compare if fetch fails */
      })
      .finally(() => {
        if (!cancelled) setCompareLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [compareWindow, customDays]);

  const setCompareWindowSafe = useCallback((id: CurveCompareWindowId | string) => {
    setCompareWindow(id as CurveCompareWindowId);
  }, []);

  const stirChart = useMemo(() => {
    if (stir?.chart?.length) {
      return stir.chart.map((p) => ({
        x: p.x,
        rate: p.implied_rate,
        prior: p.prior_rate ?? null,
        vsSofr: p.vs_sofr_bps ?? null,
        source: p.source,
        contract: p.contract,
      }));
    }
    return (stir?.sr3 || [])
      .filter((c) => c.implied_rate != null || c.settlement != null || c.prev_close != null)
      .map((c) => {
        const settlePx = c.settlement ?? c.prev_close ?? null;
        const prior =
          settlePx != null && settlePx > 50 ? 100 - settlePx : null;
        return {
          x: c.month || c.contract,
          rate: c.implied_rate,
          prior,
          vsSofr: stir?.sofr != null && c.implied_rate != null
            ? (c.implied_rate - stir.sofr) * 100
            : null,
          source: c.source,
          contract: c.contract,
        };
      });
  }, [stir]);

  const shapeHistoryCharts = useMemo(() => {
    const empty: { date: string; bps: number }[] = [];
    const map = (key: string) =>
      ((shape?.history as Record<string, { date: string; spread_bps: number }[]> | undefined)?.[key] || [])
        .map((p) => ({ date: p.date.slice(5), bps: p.spread_bps }));
    if (!shape?.history) {
      return {
        s2s10: empty, s5s30: empty, s2s5: empty, s5s10: empty,
        s10s30: empty, s3m10y: empty, fly: empty,
      };
    }
    return {
      s2s10: map('2s10s'),
      s5s30: map('5s30s'),
      s2s5: map('2s5s'),
      s5s10: map('5s10s'),
      s10s30: map('10s30s'),
      s3m10y: map('3m10y'),
      fly: map('fly_2s5s10s'),
    };
  }, [shape]);

  const basisChart = useMemo(() => {
    if (!basisHist?.history?.length) return [];
    return basisHist.history.slice(-90).map((h) => ({
      date: h.date.slice(5),
      sofr_effr: h.sofr_effr_bps,
      sofr_iorb: h.sofr_iorb_bps,
      effr_iorb: h.effr_iorb_bps,
    }));
  }, [basisHist]);

  const curveComparePoints = useMemo(() => {
    if (curveCompare?.points?.length) {
      return curveCompare.points.map((p) => ({
        label: p.label,
        today: p.today != null ? Number(Number(p.today).toFixed(3)) : null,
        historical: p.historical != null ? Number(Number(p.historical).toFixed(3)) : null,
        delta_bps: p.delta_bps ?? null,
      }));
    }
    if (curve.length) {
      return curve.map((c) => ({
        label: c.label,
        today: c.yield,
        historical: null as number | null,
        delta_bps: null as number | null,
      }));
    }
    return [];
  }, [curveCompare, curve]);

  return {
    summary, summaryCache, plumbing, basis, basisHist, stir, shape, curve, curveMeta, curveCompare, curveComparePoints, corr,
    error, loading, stirLoading,
    stirChart, shapeHistoryCharts, basisChart,
    compareWindow, setCompareWindow: setCompareWindowSafe,
    customDays, setCustomDays,
    compareLoading,
  };
}
