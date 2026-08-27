import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTerminalStore } from '../../store/terminalStore';
import { maxPainStrike } from '../../lib/options/analytics';
import { fetchVenueOptions, type VenueOptionsBundle } from '../../lib/data/deribitClient';
import { CryptoPageHeader } from './crypto/CryptoPageHeader';
import { Panel } from '../terminal/Panel';
import { EmptyState } from '../common/EmptyState';
import { fmtCompact, fmtPct, fmtPrice } from '../../lib/format';
import { chartGridProps, chartTooltipStyle } from '../../lib/chartTheme';
import { cn } from '../../lib/utils';

export function CryptoOiView() {
  const snapshot = useTerminalStore((s) => s.snapshot);
  const symbol = useTerminalStore((s) => s.symbol);
  const asset = symbol === 'ETH' ? 'ETH' : 'BTC';

  const [venues, setVenues] = useState<VenueOptionsBundle | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchVenueOptions(asset).then((data) => {
      if (!cancelled) setVenues(data);
    });
    return () => { cancelled = true; };
  }, [asset]);

  const model = useMemo(() => {
    if (!snapshot) return null;
    const S = snapshot.spot;
    const byStrike = new Map<number, { callOi: number; putOi: number }>();
    const byExpiry = snapshot.expiries.map((slice) => {
      let callOi = 0, putOi = 0, vol = 0, callIvSum = 0, callIvN = 0, putIvSum = 0, putIvN = 0;
      for (const q of slice.calls) {
        callOi += q.openInterest; vol += q.volume;
        const cur = byStrike.get(q.strike) ?? { callOi: 0, putOi: 0 };
        cur.callOi += q.openInterest; byStrike.set(q.strike, cur);
        if (q.iv != null && q.iv > 0) { callIvSum += q.iv; callIvN += 1; }
      }
      for (const q of slice.puts) {
        putOi += q.openInterest; vol += q.volume;
        const cur = byStrike.get(q.strike) ?? { callOi: 0, putOi: 0 };
        cur.putOi += q.openInterest; byStrike.set(q.strike, cur);
        if (q.iv != null && q.iv > 0) { putIvSum += q.iv; putIvN += 1; }
      }
      return {
        expiry: slice.expiry, dte: slice.dte, callOi, putOi, volume: vol,
        callIv: callIvN ? callIvSum / callIvN : null,
        putIv: putIvN ? putIvSum / putIvN : null,
        strikes: slice.calls.length + slice.puts.length,
      };
    });
    const strikeRows = [...byStrike.entries()]
      .map(([strike, row]) => ({ strike, ...row, net: row.callOi - row.putOi }))
      .sort((a, b) => Math.abs(a.strike - S) - Math.abs(b.strike - S))
      .slice(0, 30)
      .sort((a, b) => b.strike - a.strike);
    const totalCall = byExpiry.reduce((s, r) => s + r.callOi, 0);
    const totalPut = byExpiry.reduce((s, r) => s + r.putOi, 0);
    return {
      strikeRows,
      byExpiry,
      totalCall,
      totalPut,
      pcRatio: totalCall > 0 ? totalPut / totalCall : null,
      maxPain: maxPainStrike(snapshot),
      nearTerm: byExpiry.filter((r) => r.dte <= 7),
    };
  }, [snapshot]);

  if (!snapshot || !model) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#030506]">
        <CryptoPageHeader title="Open" highlight="Interest" description={`${asset} positioning at rest: OI by strike and expiry, concentration, and max pain · live Deribit chain`} />
        <Panel title="Open Interest" className="m-2 flex-1">
          <EmptyState kind="loading" title="Loading open interest…" body="Requires the active options chain snapshot." />
        </Panel>
      </div>
    );
  }

  const oiByStrike = model.strikeRows.map((row) => ({
    label: fmtPrice(row.strike, row.strike > 1000 ? 0 : 1),
    calls: row.callOi,
    puts: -row.putOi,
  }));
  const expiryLadder = model.byExpiry.map((row) => ({
    label: `${row.dte}d`,
    calls: row.callOi,
    puts: row.putOi,
    ...row,
  }));
  const maxAbsOi = Math.max(...oiByStrike.map((r) => Math.max(r.calls, -r.puts)), 1);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden bg-[#030506]">
      <CryptoPageHeader
        title="Open"
        highlight="Interest"
        description={`${asset} positioning at rest across ${snapshot.expiries.length} expiries · ${fmtCompact(model.totalCall + model.totalPut)} total contracts · put/call ${model.pcRatio?.toFixed(2) ?? '—'}`}
      />

      <div className="grid grid-cols-2 gap-px border-b border-[#20282b] bg-[#20282b] lg:grid-cols-4">
        <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Max Pain</div><div className="font-mono text-[18px] font-bold tabular-nums text-white">{model.maxPain != null ? `$${fmtPrice(model.maxPain, 0)}` : '—'}</div><div className="font-mono text-[10px] text-[#76848a]">Front expiry</div></div>
        <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Call OI</div><div className="font-mono text-[18px] font-bold tabular-nums text-[#25d7c5]">{fmtCompact(model.totalCall)}</div><div className="font-mono text-[10px] text-[#76848a]">contracts</div></div>
        <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Put OI</div><div className="font-mono text-[18px] font-bold tabular-nums text-[#e25c5c]">{fmtCompact(model.totalPut)}</div><div className="font-mono text-[10px] text-[#76848a]">contracts</div></div>
        <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Put / Call</div><div className="font-mono text-[18px] font-bold tabular-nums text-white">{model.pcRatio?.toFixed(2) ?? '—'}</div><div className="font-mono text-[10px] text-[#76848a]">{model.pcRatio != null && model.pcRatio < 1 ? 'call-skewed' : 'put-skewed'}</div></div>
      </div>

      <div className="grid gap-2 p-2 lg:grid-cols-2">
        <Panel title="OI by Strike" subtitle="Put (left, red) vs call (right, teal) · nearest 30 strikes" className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={oiByStrike} layout="vertical" margin={{ top: 6, right: 10, bottom: 2, left: 0 }}>
              <CartesianGrid {...chartGridProps} horizontal={false} />
              <XAxis type="number" domain={[-maxAbsOi, maxAbsOi]} tickFormatter={(v: number) => fmtCompact(Math.abs(v))} tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} />
              <YAxis type="category" dataKey="label" width={44} tick={{ fontSize: 8, fill: 'var(--muted-foreground)' }} interval={0} />
              <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number, name) => [fmtCompact(Math.abs(v)), name === 'calls' ? 'Call OI' : 'Put OI']} labelFormatter={(l) => `K ${l}`} />
              <ReferenceLine x={0} stroke="var(--muted-foreground)" />
              <Bar dataKey="puts" fill="#e25c5c" isAnimationActive={false} maxBarSize={9} />
              <Bar dataKey="calls" fill="#25d7c5" isAnimationActive={false} maxBarSize={9} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="OI by Expiry" subtitle="Calls vs puts stacked per expiry" className="h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={expiryLadder} margin={{ top: 6, right: 10, bottom: 2, left: 0 }}>
              <CartesianGrid {...chartGridProps} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} />
              <YAxis tickFormatter={(v: number) => fmtCompact(v)} tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} width={44} />
              <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number, name) => [fmtCompact(v), name === 'calls' ? 'Call OI' : 'Put OI']} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Bar dataKey="calls" stackId="oi" fill="#25d7c5" isAnimationActive={false} />
              <Bar dataKey="puts" stackId="oi" fill="#e25c5c" isAnimationActive={false}>
                {expiryLadder.map((row) => <Cell key={row.expiry} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div className="px-2 pb-2">
        <Panel title="Expiry Ladder" subtitle="OI, volume and average IV per expiry">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse font-mono text-[11px]">
              <thead className="bg-[#0a0d0e] text-[#8b999f]"><tr><th className="px-3 py-1.5 text-left">DTE</th><th className="px-3 py-1.5 text-left">Expiry</th><th className="px-3 py-1.5 text-right">Call OI</th><th className="px-3 py-1.5 text-right">Put OI</th><th className="px-3 py-1.5 text-right">Volume</th><th className="px-3 py-1.5 text-right">Avg Call IV</th><th className="px-3 py-1.5 text-right">Avg Put IV</th><th className="px-3 py-1.5 text-right">Strikes</th></tr></thead>
              <tbody>{model.byExpiry.map((row) => (
                <tr key={row.expiry} className={cn('border-t border-[#1a1f22]', row.dte <= 1 && 'bg-[#101619]')}>
                  <td className="px-3 py-1.5 font-bold text-white">{row.dte}d</td>
                  <td className="px-3 py-1.5 text-[#a6b0b4]">{new Intl.DateTimeFormat(undefined, { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(row.expiry))}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#25d7c5]">{fmtCompact(row.callOi)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#e25c5c]">{fmtCompact(row.putOi)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtCompact(row.volume)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#8b999f]">{row.callIv != null ? fmtPct(row.callIv) : '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#8b999f]">{row.putIv != null ? fmtPct(row.putIv) : '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#8b999f]">{row.strikes}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Panel>
      </div>
      <div className="px-2 pb-2">
        <Panel title="Venue Comparison" subtitle="Options 24h volume and open interest · Deribit vs OKX vs Bybit (public data)">
          {venues?.venues.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse font-mono text-[11px]">
                <thead className="bg-[#0a0d0e] text-[#8b999f]"><tr><th className="px-3 py-1.5 text-left">Venue</th><th className="px-3 py-1.5 text-right">Instruments</th><th className="px-3 py-1.5 text-right">24h Volume ({asset})</th><th className="px-3 py-1.5 text-right">24h Volume (USD)</th><th className="px-3 py-1.5 text-right">Open Interest</th><th className="px-3 py-1.5 text-left">OI Unit</th></tr></thead>
                <tbody>{venues.venues.map((v) => {
                  const oi = v.openIntContracts ?? v.openIntCcy ?? null;
                  const oiUnit = v.openIntContracts != null ? 'contracts' : v.openIntCcy != null ? asset : '—';
                  const totalVol = venues.venues.reduce((s, x) => s + (x.volCcy24h ?? 0), 0) || 1;
                  return (
                    <tr key={v.venue} className={cn('border-t border-[#1a1f22]', v.venue === 'Deribit' && 'bg-[#101619]')}>
                      <td className={cn('px-3 py-1.5 font-bold', v.venue === 'Deribit' ? 'text-[#25d7c5]' : 'text-white')}>{v.venue}{v.venue === 'Deribit' && <span className="ml-1.5 text-[9px] text-[#76848a]">PRIMARY</span>}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#8b999f]">{v.instruments.toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#d7dee0]">{fmtCompact(v.volCcy24h ?? 0)}<span className="ml-2 text-[9px] text-[#76848a]">{(((v.volCcy24h ?? 0) / totalVol) * 100).toFixed(0)}%</span></td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#d7dee0]">{v.volUsd24h ? `$${fmtCompact(v.volUsd24h)}` : '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-[#d7dee0]">{oi != null ? fmtCompact(oi) : '—'}</td>
                      <td className="px-3 py-1.5 text-[10px] text-[#76848a]">{oiUnit}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          ) : (
            <EmptyState kind="loading" title="Loading venue comparison…" body="Aggregating public Deribit / OKX / Bybit option tickers." />
          )}
          <p className="px-3 py-2 font-mono text-[10px] text-[#76848a]">Volume in base currency units as reported by each venue; OI units differ by venue (contracts vs coin). OKX contracts = 0.01 {asset}. Venue totals are not perfectly comparable across contract specs.</p>
        </Panel>
      </div>
    </div>
  );
}
