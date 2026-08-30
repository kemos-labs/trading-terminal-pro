import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis,
} from 'recharts';
import { CHART, chartAxisTick, tightDomain } from '../../../lib/chartTheme';
import { fetchDeribitMarket, type DeribitMarketBundle } from '../../../api/deribit';
import { toFundingSnapshot } from '../../../lib/math/carry/funding';
import { computeBasis } from '../../../lib/math/carry/basis';
import { yearFractionAct365 } from '../../../lib/math/units';

export function CryptoCarryView() {
  const [bundle, setBundle] = useState<DeribitMarketBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchDeribitMarket('BTC').then(r => {
      if (cancelled) return;
      setBundle(r);
      setStale(Date.now() - r.fetchedAt > 60_000);
    }).catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  if (error) return (
    <div className="rounded border border-destructive bg-destructive/10 p-4 font-mono text-xs" role="alert">
      <div className="font-bold">Provider unavailable</div>
      <div className="mt-1 text-muted-foreground">{error}</div>
    </div>
  );

  if (!bundle) return <div className="p-4 font-mono text-xs animate-pulse">Loading carry…</div>;

  const perp = bundle.instruments.find(t => t.kind === 'perp');
  const spot = bundle.indexPrice ?? perp?.markPrice ?? null;
  const now = Date.now();

  // Native 8h funding from the perp quote; annualization via canonical math (×1095), labelled as run-rate.
  const funding = bundle.funding8h != null
    ? toFundingSnapshot('Deribit', `${bundle.currency}-PERPETUAL`, bundle.funding8h, perp?.timestamp ?? bundle.fetchedAt, {})
    : null;

  // Dated futures: all valid NON-EXPIRED futures with an observed price.
  const datedFutures = bundle.instruments
    .filter(t => t.kind === 'future' && t.expiryMs != null && t.expiryMs > now && t.markPrice != null && t.markPrice > 0)
    .sort((a, b) => a.expiryMs! - b.expiryMs!);
  const nearest = datedFutures[0] ?? null;
  const basis = spot != null && nearest
    ? computeBasis(spot, nearest.markPrice!, nearest.expiryMs!, now, { instrument: nearest.instrument })
    : null;

  /** Basis TERM STRUCTURE — simple annualized carry per dated future (observed marks). */
  const basisTerm = useMemo(() => {
    if (spot == null) return [];
    return datedFutures.slice(0, 12).map((f) => {
      const b = computeBasis(spot, f.markPrice!, f.expiryMs!, now, { instrument: f.instrument });
      return {
        label: new Date(f.expiryMs!).toISOString().slice(5, 10),
        dte: Math.round((f.expiryMs! - now) / 864e5),
        annPct: b != null ? b.simpleAnnualized * 100 : null,
        pct: b != null ? b.percentage * 100 : null,
      };
    });
  }, [datedFutures, spot, now]);

  /** Funding history — Deribit public get_funding_history (server-cached). */
  const [fundingHistory, setFundingHistory] = useState<{ t: number; rate8h: number }[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/deribit/funding-history?currency=${bundle.currency}&days=30`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const rows = Array.isArray(d?.points) ? d.points : [];
        setFundingHistory(rows.map((r: { timestamp?: number; current_funding_8h?: number; funding_8h?: number }) => ({
          t: r.timestamp ?? 0,
          rate8h: (r.current_funding_8h ?? r.funding_8h ?? 0) * 100,
        })).filter((r: { t: number }) => r.t > 0));
      })
      .catch(() => { if (!cancelled) setFundingHistory(null); });
    return () => { cancelled = true; };
  }, [bundle.currency]);

  const basisDomain = useMemo(
    () => tightDomain(basisTerm.map((p) => p.annPct), 0.12, { minPadAbs: 0.5 }),
    [basisTerm],
  );
  const fundingDomain = useMemo(
    () => tightDomain((fundingHistory ?? []).map((r) => r.rate8h), 0.15, { minPadAbs: 0.005 }),
    [fundingHistory],
  );

  return (
    <div data-testid="carry-workstation" className="space-y-3">
      <div className="flex flex-wrap gap-2 font-mono text-xs">
        <span className="rounded bg-muted px-2 py-1">As of {new Date(bundle.fetchedAt).toISOString().slice(11, 19)}Z</span>
        {stale
          ? <span className="rounded bg-amber-500/20 px-2 py-1 text-amber-400">Stale</span>
          : <span className="rounded bg-emerald-500/20 px-2 py-1 text-emerald-400" title={`Deribit snapshot ${new Date(bundle.fetchedAt).toISOString()}`}>Observed</span>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded border p-3">
          <div className="font-mono text-xs font-bold uppercase">Perpetual Funding (Deribit)</div>
          {funding ? (
            <div className="mt-2 font-mono text-xs">
              <div>Native 8h: {(funding.rawRate8h * 100).toFixed(4)}%</div>
              <div>Simple annualized run-rate: {(funding.simpleAnnualizedRunRate * 100).toFixed(2)}% <span className="text-muted-foreground">(rate8h × 1095 — run-rate, not yield)</span></div>
              <div className="mt-1 font-mono text-[10px] text-muted-foreground">Direction: {funding.direction} · {new Date(funding.timestamp).toISOString().slice(11, 19)}Z</div>
            </div>
          ) : (
            <div className="mt-2 font-mono text-xs text-muted-foreground" data-testid="funding-unavailable">Unavailable — Deribit perp funding not reported.</div>
          )}
        </div>
        <div className="rounded border p-3">
          <div className="font-mono text-xs font-bold uppercase">Dated Basis</div>
          {basis ? (
            <div className="mt-2 font-mono text-xs">
              <div>Instrument: {basis.instrument} · DTE {basis.dte.toFixed(1)} (ACT/365F T={yearFractionAct365(now, nearest!.expiryMs!).toFixed(4)})</div>
              <div>Absolute: {basis.absolute.toFixed(1)} · %: {(basis.percentage * 100).toFixed(3)}%</div>
              <div>Simple ann: {(basis.simpleAnnualized * 100).toFixed(2)}% · Log ann: {(basis.logAnnualized * 100).toFixed(2)}% <span className="text-muted-foreground">(distinct)</span></div>
              <div className="mt-1 text-[10px] text-muted-foreground">Spot {basis.spot} · Future {basis.futurePrice}</div>
            </div>
          ) : (
            <div className="mt-2 font-mono text-xs text-muted-foreground" data-testid="basis-unavailable">
              {spot == null
                ? 'Unavailable — venue index/spot not reported.'
                : 'Unavailable — no valid non-expired future with observed price.'}
            </div>
          )}
        </div>
      </div>
      {/* Basis term structure — dated futures curve (observed marks) */}
      <div className="rounded border p-3" data-testid="carry-basis-term">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <div className="font-mono text-xs font-bold uppercase">Basis Term Structure — simple annualized per future</div>
          <span className="font-mono text-[10px] text-muted-foreground">y = simple ann. % · points at actual expiries · straight segments</span>
        </div>
        {basisTerm.length >= 2 ? (
          <div className="mt-2 h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={basisTerm} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ ...chartAxisTick, fontSize: 9 }} interval={0} height={22} />
                <YAxis tick={chartAxisTick} width={46} domain={basisDomain as [number, number]} tickFormatter={(v) => `${Number(v).toFixed(1)}%`} />
                <ReferenceLine y={0} stroke={CHART.axisLine} strokeDasharray="4 3" />
                <Line type="linear" dataKey="annPct" stroke={CHART.series.rate} strokeWidth={2}
                  dot={{ r: 3, fill: CHART.series.rate }} activeDot={{ r: 5 }} connectNulls isAnimationActive={false} name="simple ann. %" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="mt-2 font-mono text-[10px] text-muted-foreground" data-testid="basis-term-unavailable">
            {basisTerm.length === 0 ? 'No dated futures with observed prices — term structure unavailable.' : 'Need ≥2 futures for a term structure — unavailable.'}
          </div>
        )}
      </div>

      {/* Funding history — 30d 8h rates (observed) */}
      <div className="rounded border p-3" data-testid="carry-funding-history">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <div className="font-mono text-xs font-bold uppercase">Funding History — 8h rate, 30d</div>
          <span className="font-mono text-[10px] text-muted-foreground">Deribit get_funding_history · zero line shown</span>
        </div>
        {fundingHistory && fundingHistory.length >= 2 ? (
          <div className="mt-2 h-36">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={fundingHistory.map((r, i) => ({ i, t: r.t, rate: r.rate8h }))} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="t" tick={{ ...chartAxisTick, fontSize: 9 }} tickFormatter={(t) => new Date(Number(t)).toISOString().slice(5, 10)} height={22} minTickGap={28} />
                <YAxis tick={chartAxisTick} width={56} domain={fundingDomain as [number, number]} tickFormatter={(v) => `${Number(v).toFixed(3)}%`} />
                <ReferenceLine y={0} stroke={CHART.axisLine} strokeDasharray="4 3" />
                <Line type="linear" dataKey="rate" stroke={CHART.series.up} strokeWidth={1.75} dot={false} isAnimationActive={false} name="8h rate %" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="mt-2 font-mono text-[10px] text-muted-foreground" data-testid="funding-history-unavailable">
            Funding history unavailable (endpoint unreachable or too few points) — current 8h print remains above.
          </div>
        )}
      </div>

      <div className="rounded border p-2 font-mono text-[10px] text-muted-foreground">
        Perpetual funding stays separate from dated maturity; no unlabeled APR; no synthetic missing expiry.
      </div>
    </div>
  );
}
