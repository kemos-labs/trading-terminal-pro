import { useMemo } from 'react';
import { useTerminalStore } from '../../store/terminalStore';
import { CryptoPageHeader } from './crypto/CryptoPageHeader';
import { Panel } from '../terminal/Panel';
import { EmptyState } from '../common/EmptyState';
import { fmtCompact } from '../../lib/format';
import { cn } from '../../lib/utils';

function nearestDelta<T extends { delta: number | null; iv: number | null }>(
  quotes: T[],
  target: number,
  tolerance = 0.14,
): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const q of quotes) {
    if (q.delta == null || q.iv == null || !(q.iv > 0) || q.iv > 3) continue;
    const dist = Math.abs(q.delta - target);
    if (dist > tolerance) continue;
    if (dist < bestDist) { bestDist = dist; best = q; }
  }
  return best;
}

/** Max pain for one expiry slice: settlement strike minimising aggregate intrinsic payout. */
function maxPainForSlice(
  slice: { calls: { strike: number; openInterest: number }[]; puts: { strike: number; openInterest: number }[]; spot?: number },
  spot: number,
): number | null {
  const allStrikes = [...new Set([...slice.calls, ...slice.puts].map((q) => q.strike))].sort((a, b) => a - b);
  if (!allStrikes.length) return null;
  let minPain = Infinity;
  let maxPain = allStrikes[0]!;
  for (const settle of allStrikes) {
    let pain = 0;
    for (const q of slice.calls) if (settle > q.strike) pain += (settle - q.strike) * q.openInterest;
    for (const q of slice.puts) if (q.strike > settle) pain += (q.strike - settle) * q.openInterest;
    if (pain < minPain) { minPain = pain; maxPain = settle; }
  }
  return maxPain || spot;
}

interface ScanRow {
  expiry: string;
  dte: number;
  atmIv: number | null;
  rr25: number | null;
  putSkew: number | null;
  callWing: number | null;
  callOi: number;
  putOi: number;
  volume: number;
  maxPainDist: number | null;
}

export function CryptoScannerView() {
  const snapshot = useTerminalStore((s) => s.snapshot);
  const symbol = useTerminalStore((s) => s.symbol);
  const asset = symbol === 'ETH' ? 'ETH' : 'BTC';

  const rows = useMemo<ScanRow[]>(() => {
    if (!snapshot) return [];
    const S = snapshot.spot;
    return snapshot.expiries.map((slice) => {
      const atmC = nearestDelta(slice.calls, 0.5, 0.15);
      const atmP = nearestDelta(slice.puts, -0.5, 0.15);
      const atm = atmC?.iv != null && atmP?.iv != null ? (atmC.iv + atmP.iv) / 2 : atmC?.iv ?? atmP?.iv ?? null;
      const c25 = nearestDelta(slice.calls, 0.25);
      const p25 = nearestDelta(slice.puts, -0.25);
      const p10 = nearestDelta(slice.puts, -0.10, 0.08);
      const c10 = nearestDelta(slice.calls, 0.10, 0.08);
      const pain = maxPainForSlice(slice, S);
      let callOi = 0, putOi = 0, volume = 0;
      for (const q of slice.calls) { callOi += q.openInterest; volume += q.volume; }
      for (const q of slice.puts) { putOi += q.openInterest; volume += q.volume; }
      return {
        expiry: slice.expiry,
        dte: slice.dte,
        atmIv: atm != null ? atm * 100 : null,
        rr25: c25?.iv != null && p25?.iv != null ? (c25.iv - p25.iv) * 100 : null,
        putSkew: p10?.iv != null && atm != null ? (p10.iv - atm) * 100 : null,
        callWing: c10?.iv != null && atm != null ? (c10.iv - atm) * 100 : null,
        callOi,
        putOi,
        volume,
        maxPainDist: pain != null ? (pain / S - 1) * 100 : null,
      };
    });
  }, [snapshot]);

  const extremes = useMemo(() => {
    if (!rows.length) return null;
    const withVal = <K extends keyof ScanRow>(key: K, pred: (v: number) => boolean) =>
      rows.filter((r) => typeof r[key] === 'number' && pred(r[key] as number));
    const richestIv = rows.filter((r) => r.atmIv != null).sort((a, b) => b.atmIv! - a.atmIv!)[0] ?? null;
    const steepestRr = rows.filter((r) => r.rr25 != null).sort((a, b) => Math.abs(b.rr25!) - Math.abs(a.rr25!))[0] ?? null;
    const richestPuts = withVal('putSkew', () => true).sort((a, b) => b.putSkew! - a.putSkew!)[0] ?? null;
    const busiest = [...rows].sort((a, b) => b.volume - a.volume)[0] ?? null;
    return { richestIv, steepestRr, richestPuts, busiest };
  }, [rows]);

  if (!snapshot || !rows.length) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#030506]">
        <CryptoPageHeader title="Term" highlight="Scanner" description={`${asset} cross-expiry scan: IV, skew, wings, OI and max-pain distance · live Deribit chain`} />
        <Panel title="Term Scanner" className="m-2 flex-1">
          <EmptyState kind="loading" title="Loading scanner…" body="Requires the active options chain snapshot." />
        </Panel>
      </div>
    );
  }

  const avgRr = (() => {
    const vals = rows.filter((r) => r.rr25 != null).map((r) => r.rr25!);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  })();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden bg-[#030506]">
      <CryptoPageHeader
        title="Term"
        highlight="Scanner"
        description={`${asset} cross-expiry scan across ${rows.length} expiries · avg 25Δ RR ${avgRr != null ? `${avgRr.toFixed(2)} vp` : '—'}`}
      />

      {extremes && (
        <div className="grid grid-cols-2 gap-px border-b border-[#20282b] bg-[#20282b] lg:grid-cols-4">
          <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Richest ATM IV</div><div className="font-mono text-[16px] font-bold tabular-nums text-white">{extremes.richestIv ? `${extremes.richestIv.dte}d · ${extremes.richestIv.atmIv?.toFixed(1)}%` : '—'}</div></div>
          <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Steepest 25Δ RR</div><div className={cn('font-mono text-[16px] font-bold tabular-nums', (extremes.steepestRr?.rr25 ?? 0) >= 0 ? 'text-[#25d7c5]' : 'text-[#e25c5c]')}>{extremes.steepestRr ? `${extremes.steepestRr.dte}d · ${extremes.steepestRr.rr25?.toFixed(2)} vp` : '—'}</div></div>
          <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Richest 10Δ Put</div><div className="font-mono text-[16px] font-bold tabular-nums text-[#e25c5c]">{extremes.richestPuts ? `${extremes.richestPuts.dte}d · +${extremes.richestPuts.putSkew?.toFixed(1)} vp over ATM` : '—'}</div></div>
          <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Busiest Volume</div><div className="font-mono text-[16px] font-bold tabular-nums text-white">{extremes.busiest ? `${extremes.busiest.dte}d · ${fmtCompact(extremes.busiest.volume)}` : '—'}</div></div>
        </div>
      )}

      <div className="p-2">
        <Panel title="Expiry Scan" subtitle="One row per expiry · extremes vs term average highlighted">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse font-mono text-[11px]">
              <thead className="bg-[#0a0d0e] text-[#8b999f]">
                <tr>
                  <th className="px-3 py-1.5 text-left">DTE</th>
                  <th className="px-3 py-1.5 text-right">ATM IV</th>
                  <th className="px-3 py-1.5 text-right">25Δ RR</th>
                  <th className="px-3 py-1.5 text-right">10Δ Put − ATM</th>
                  <th className="px-3 py-1.5 text-right">10Δ Call − ATM</th>
                  <th className="px-3 py-1.5 text-right">Call OI</th>
                  <th className="px-3 py-1.5 text-right">Put OI</th>
                  <th className="px-3 py-1.5 text-right">Volume</th>
                  <th className="px-3 py-1.5 text-right">Max Pain Δ</th>
                </tr>
              </thead>
              <tbody>{rows.map((row) => (
                <tr key={row.expiry} className="border-t border-[#1a1f22]">
                  <td className="px-3 py-1.5 font-bold text-white">{row.dte}d</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#d7dee0]">{row.atmIv != null ? `${row.atmIv.toFixed(1)}%` : '—'}</td>
                  <td className={cn('px-3 py-1.5 text-right tabular-nums', row.rr25 == null ? 'text-[#4a565b]' : row.rr25 >= (avgRr ?? 0) ? 'text-[#25d7c5]' : 'text-[#e25c5c]')}>
                    {row.rr25 != null ? `${row.rr25 >= 0 ? '+' : ''}${row.rr25.toFixed(2)}` : '—'}
                  </td>
                  <td className={cn('px-3 py-1.5 text-right tabular-nums', row.putSkew != null && row.putSkew > 8 ? 'text-[#e25c5c]' : 'text-[#8b999f]')}>
                    {row.putSkew != null ? `+${row.putSkew.toFixed(1)}` : '—'}
                  </td>
                  <td className={cn('px-3 py-1.5 text-right tabular-nums', row.callWing != null && row.callWing > 8 ? 'text-[#25d7c5]' : 'text-[#8b999f]')}>
                    {row.callWing != null ? `+${row.callWing.toFixed(1)}` : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#25d7c5]">{fmtCompact(row.callOi)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#e25c5c]">{fmtCompact(row.putOi)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#d7dee0]">{fmtCompact(row.volume)}</td>
                  <td className={cn('px-3 py-1.5 text-right tabular-nums', (row.maxPainDist ?? 0) >= 0 ? 'text-[#37c990]' : 'text-[#e25c5c]')}>
                    {row.maxPainDist != null ? `${row.maxPainDist >= 0 ? '+' : ''}${row.maxPainDist.toFixed(2)}%` : '—'}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="px-3 py-2 font-mono text-[10px] text-[#76848a]">Skew columns in vol points over ATM. Max-pain distance is front-expiry settlement pain vs spot — a magnet, not a target. All values from the live Deribit chain.</p>
        </Panel>
      </div>
    </div>
  );
}
