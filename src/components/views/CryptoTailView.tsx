import { useMemo, useState } from 'react';
import { useTerminalStore } from '../../store/terminalStore';
import { CryptoPageHeader } from './crypto/CryptoPageHeader';
import { Panel } from '../terminal/Panel';
import { EmptyState } from '../common/EmptyState';
import { fmtCompact, fmtPct, fmtPrice } from '../../lib/format';
import type { OptionQuote } from '../../lib/options/types';
import { cn } from '../../lib/utils';

/** Premium as % of spot, with extra precision for cheap far-OTM legs. */
function fmtTailPct(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  return fmtPct(v, v > 0 && v < 0.001 ? 4 : 2);
}

const OFFSETS = [10, 20, 30] as const;
type Side = 'put' | 'call';

interface TailRow {
  side: Side;
  offset: number;
  strike: number | null;
  premium: number | null;
  premiumPct: number | null;
  iv: number | null;
  oi: number | null;
  delta: number | null;
}

/** Nearest strike at or beyond an offset from spot. */
function pickTailStrike(
  quotes: OptionQuote[],
  spot: number,
  side: Side,
  offset: number,
): TailRow {
  const target = side === 'put' ? spot * (1 - offset / 100) : spot * (1 + offset / 100);
  const candidates = quotes.filter((q) => (side === 'put' ? q.strike <= target : q.strike >= target));
  if (!candidates.length) {
    return { side, offset, strike: null, premium: null, premiumPct: null, iv: null, oi: null, delta: null };
  }
  const q = candidates.reduce((best, cur) =>
    Math.abs(cur.strike - target) < Math.abs(best.strike - target) ? cur : best,
  );
  const premium = q.mid || q.last;
  return {
    side,
    offset,
    strike: q.strike,
    premium,
    premiumPct: premium != null ? premium / spot : null,
    iv: q.iv,
    oi: q.openInterest,
    delta: q.delta,
  };
}

export function CryptoTailView() {
  const snapshot = useTerminalStore((s) => s.snapshot);
  const symbol = useTerminalStore((s) => s.symbol);
  const asset = symbol === 'ETH' ? 'ETH' : 'BTC';
  const [horizon, setHorizon] = useState<30 | 60 | 90>(30);

  const slice = useMemo(() => {
    if (!snapshot) return null;
    return snapshot.expiries.find((e) => e.dte <= horizon) ?? snapshot.expiries[snapshot.expiries.length - 1] ?? null;
  }, [horizon, snapshot]);

  const rows = useMemo<TailRow[]>(() => {
    if (!slice || !snapshot) return [];
    const out: TailRow[] = [];
    for (const offset of OFFSETS) {
      out.push(pickTailStrike(slice.puts, snapshot.spot, 'put', offset));
      out.push(pickTailStrike(slice.calls, snapshot.spot, 'call', offset));
    }
    return out;
  }, [slice, snapshot]);

  if (!snapshot || !slice) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#030506]">
        <CryptoPageHeader title="Tail" highlight="Strike" description={`${asset} out-of-the-money option costs for crash / melt-up protection · live Deribit chain`} />
        <Panel title="Tail Strike" className="m-2 flex-1">
          <EmptyState kind="loading" title="Loading tail strikes…" body="Requires the active options chain snapshot." />
        </Panel>
      </div>
    );
  }

  const put10 = rows.find((r) => r.side === 'put' && r.offset === 10);
  const call10 = rows.find((r) => r.side === 'call' && r.offset === 10);
  const both10 = (put10?.premiumPct ?? 0) + (call10?.premiumPct ?? 0);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden bg-[#030506]">
      <CryptoPageHeader
        title="Tail"
        highlight="Strike"
        description={`${asset} OTM option costs at ±10/20/30% from spot · ${slice.dte}d expiry · live Deribit chain`}
        actions={
          <div className="flex gap-1">
            {([30, 60, 90] as const).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setHorizon(h)}
                className={cn(
                  'border px-1.5 font-mono text-[10px] uppercase',
                  h === horizon ? 'border-[#25d7c5] bg-[#25d7c5]/10 text-[#25d7c5]' : 'border-[#20282b] text-[#8b999f] hover:text-[#d7dee0]',
                )}
              >
                ≤{h}d
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-px border-b border-[#20282b] bg-[#20282b] sm:grid-cols-3">
        <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Crash Hedge ±10%</div><div className="font-mono text-[18px] font-bold tabular-nums text-[#e25c5c]">{put10?.premiumPct != null ? fmtTailPct(put10.premiumPct) : '—'}</div><div className="font-mono text-[10px] text-[#76848a]">of spot · {put10?.strike != null ? `$${fmtPrice(put10.strike, 0)}` : 'no strike'}</div></div>
        <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Melt-up Call ±10%</div><div className="font-mono text-[18px] font-bold tabular-nums text-[#25d7c5]">{call10?.premiumPct != null ? fmtTailPct(call10.premiumPct) : '—'}</div><div className="font-mono text-[10px] text-[#76848a]">of spot · {call10?.strike != null ? `$${fmtPrice(call10.strike, 0)}` : 'no strike'}</div></div>
        <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Strangle Cost ±10%</div><div className="font-mono text-[18px] font-bold tabular-nums text-white">{fmtTailPct(both10)}</div><div className="font-mono text-[10px] text-[#76848a]">put + call premium</div></div>
      </div>

      <div className="p-2">
        <Panel title="Tail Cost Ladder" subtitle={`Nearest listed strike at or beyond each offset · ${slice.dte}d expiry`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse font-mono text-[11px]">
              <thead className="bg-[#0a0d0e] text-[#8b999f]">
                <tr><th className="px-3 py-1.5 text-left">Leg</th><th className="px-3 py-1.5 text-right">Offset</th><th className="px-3 py-1.5 text-right">Strike</th><th className="px-3 py-1.5 text-right">Premium</th><th className="px-3 py-1.5 text-right">% of Spot</th><th className="px-3 py-1.5 text-right">IV</th><th className="px-3 py-1.5 text-right">Δ</th><th className="px-3 py-1.5 text-right">OI</th></tr>
              </thead>
              <tbody>{rows.map((row) => (
                <tr key={`${row.side}-${row.offset}`} className="border-t border-[#1a1f22]">
                  <td className={cn('px-3 py-1.5 font-bold', row.side === 'put' ? 'text-[#e25c5c]' : 'text-[#25d7c5]')}>{row.side === 'put' ? 'PUT' : 'CALL'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#8b999f]">{row.side === 'put' ? '−' : '+'}{row.offset}%</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#d7dee0]">{row.strike != null ? `$${fmtPrice(row.strike, row.strike > 1000 ? 0 : 1)}` : '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-white">{row.premium != null ? `$${fmtPrice(row.premium, row.premium > 100 ? 0 : 2)}` : '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#d7dee0]">{row.premiumPct != null ? fmtTailPct(row.premiumPct) : '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#8b999f]">{row.iv != null ? fmtPct(row.iv) : '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#8b999f]">{row.delta != null ? row.delta.toFixed(3) : '—'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#8b999f]">{row.oi != null ? fmtCompact(row.oi) : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="px-3 py-2 font-mono text-[10px] text-[#76848a]">Premium uses mark price (fallback last). Costs are for 1 contract of base exposure; scale by position notional. No liquidity/size adjustment applied.</p>
        </Panel>
      </div>
    </div>
  );
}
