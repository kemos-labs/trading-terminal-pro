import { useMemo } from 'react';
import { useTerminalStore } from '../../store/terminalStore';
import { dealerExposure, maxPainStrike } from '../../lib/options/analytics';
import { CryptoPageHeader } from './crypto/CryptoPageHeader';
import { Panel } from '../terminal/Panel';
import { EmptyState } from '../common/EmptyState';
import { fmtCompact, fmtPrice } from '../../lib/format';
import { cn } from '../../lib/utils';

type LevelRow = {
  label: string;
  strike: number;
  vsSpot: number;
  strength: number | null;
  tone: 'up' | 'down' | 'warn' | 'neutral';
};

export function CryptoLevelsView() {
  const snapshot = useTerminalStore((s) => s.snapshot);
  const symbol = useTerminalStore((s) => s.symbol);
  const asset = symbol === 'ETH' ? 'ETH' : 'BTC';

  const exposure = useMemo(() => (snapshot ? dealerExposure(snapshot, { weight: 'oi' }) : null), [snapshot]);
  const maxPain = useMemo(() => (snapshot ? maxPainStrike(snapshot) : null), [snapshot]);

  const rows = useMemo<LevelRow[]>(() => {
    if (!snapshot || !exposure) return [];
    const S = snapshot.spot;
    const vs = (k: number) => k / S - 1;
    const callWalls = [...exposure.points].sort((a, b) => b.callGEX - a.callGEX).slice(0, 2);
    const putWalls = [...exposure.points].sort((a, b) => a.putGEX - b.putGEX).slice(0, 2);
    const list: LevelRow[] = [];
    callWalls.forEach((p, i) => p.strike != null && list.push({ label: `Call Wall ${i + 1}`, strike: p.strike, vsSpot: vs(p.strike), strength: p.callGEX, tone: 'up' }));
    if (exposure.gammaFlip != null) list.push({ label: 'GEX Flip', strike: exposure.gammaFlip, vsSpot: vs(exposure.gammaFlip), strength: null, tone: 'warn' });
    list.push({ label: 'Spot', strike: S, vsSpot: 0, strength: null, tone: 'neutral' });
    if (maxPain != null) list.push({ label: 'Max Pain', strike: maxPain, vsSpot: vs(maxPain), strength: null, tone: 'neutral' });
    putWalls.forEach((p, i) => p.strike != null && list.push({ label: `Put Wall ${i + 1}`, strike: p.strike, vsSpot: vs(p.strike), strength: Math.abs(p.putGEX), tone: 'down' }));
    return list;
  }, [exposure, maxPain, snapshot]);

  if (!snapshot || !exposure) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#030506]">
        <CryptoPageHeader title="Key" highlight="Levels" description={`${asset} dealer levels: gamma walls, flip, and max pain · live Deribit chain`} />
        <Panel title="Key Levels" className="m-2 flex-1">
          <EmptyState kind="loading" title="Loading dealer levels…" body="Requires the active options chain snapshot." />
        </Panel>
      </div>
    );
  }

  const longGamma = exposure.totalGEX >= 0;
  const maxAbsStrength = Math.max(...rows.map((r) => Math.abs(r.strength ?? 0)), 1);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden bg-[#030506]">
      <CryptoPageHeader
        title="Key"
        highlight="Levels"
        description={`${asset} dealer levels derived from OI-weighted gamma · regime ${longGamma ? 'LONG gamma (stabilising)' : 'SHORT gamma (amplifying)'} · net GEX ${fmtCompact(exposure.totalGEX)}`}
        actions={<span className={cn('min-h-7 border px-2 font-mono text-[10px] font-bold uppercase leading-7', longGamma ? 'border-[#25d7c5] text-[#25d7c5]' : 'border-[#e25c5c] text-[#e25c5c]')}>{longGamma ? 'LONG Γ' : 'SHORT Γ'}</span>}
      />

      <div className="grid grid-cols-2 gap-px border-b border-[#20282b] bg-[#20282b] lg:grid-cols-4">
        <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">GEX Flip</div><div className="font-mono text-[18px] font-bold tabular-nums text-white">{exposure.gammaFlip != null ? `$${fmtPrice(exposure.gammaFlip, 0)}` : '—'}</div><div className="font-mono text-[10px] text-[#76848a]">{exposure.gammaFlip != null ? `${((exposure.gammaFlip / snapshot.spot - 1) * 100).toFixed(2)}% vs spot` : 'no crossing'}</div></div>
        <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Net GEX</div><div className={cn('font-mono text-[18px] font-bold tabular-nums', longGamma ? 'text-[#25d7c5]' : 'text-[#e25c5c]')}>{fmtCompact(exposure.totalGEX)}</div><div className="font-mono text-[10px] text-[#76848a]">USD per 1% move</div></div>
        <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Max Pain</div><div className="font-mono text-[18px] font-bold tabular-nums text-white">{maxPain != null ? `$${fmtPrice(maxPain, 0)}` : '—'}</div><div className="font-mono text-[10px] text-[#76848a]">Front-expiry settlement pain</div></div>
        <div className="bg-[#090c0d] p-3"><div className="font-mono text-[10px] uppercase tracking-wider text-[#8b999f]">Spot</div><div className="font-mono text-[18px] font-bold tabular-nums text-white">${fmtPrice(snapshot.spot, snapshot.spot > 1000 ? 0 : 2)}</div><div className="font-mono text-[10px] text-[#76848a]">Deribit index</div></div>
      </div>

      <div className="grid gap-2 p-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
        <Panel title="Level Ladder" subtitle="Walls, flip, and spot · ordered by price">
          <div className="overflow-auto">
            <table className="w-full border-collapse font-mono text-[11px]">
              <thead className="bg-[#0a0d0e] text-[#8b999f]"><tr><th className="px-3 py-1.5 text-left">Level</th><th className="px-3 py-1.5 text-right">Strike</th><th className="px-3 py-1.5 text-right">VS Spot</th><th className="px-3 py-1.5 text-right">Strength</th><th className="px-3 py-1.5 text-left">Bar</th></tr></thead>
              <tbody>{rows.map((row) => (
                <tr key={row.label} className={cn('border-t border-[#1a1f22]', row.label === 'Spot' && 'bg-[#101619]')}>
                  <td className="px-3 py-1.5 font-bold text-white">{row.label}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#d7dee0]">${fmtPrice(row.strike, row.strike > 1000 ? 0 : 1)}</td>
                  <td className={cn('px-3 py-1.5 text-right tabular-nums', row.vsSpot >= 0 ? 'text-[#37c990]' : 'text-[#e25c5c]')}>{row.vsSpot >= 0 ? '+' : ''}{(row.vsSpot * 100).toFixed(2)}%</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[#8b999f]">{row.strength != null ? fmtCompact(row.strength) : 'n/a'}</td>
                  <td className="px-3 py-1.5">
                    {row.strength != null && (
                      <div className="h-1.5 w-full min-w-[80px] bg-[#141a1c]">
                        <div className={cn('h-full', row.tone === 'up' ? 'bg-[#25d7c5]' : 'bg-[#e25c5c]')} style={{ width: `${Math.max(3, (Math.abs(row.strength) / maxAbsStrength) * 100)}%` }} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Regime Notes" subtitle="How to read these levels">
          <div className="space-y-2 p-3 font-mono text-[11px] leading-relaxed text-[#a6b0b4]">
            <p><span className="font-bold text-[#25d7c5]">Call walls</span> mark strikes with the largest positive dealer gamma — upside often grinds or pins into them.</p>
            <p><span className="font-bold text-[#e25c5c]">Put walls</span> mark the largest negative-gamma nodes — downside accelerates through them once spot is below the flip.</p>
            <p><span className="font-bold text-[#eab308]">GEX flip</span> is the cumulative zero-crossing: above it dealers dampen moves, below it they amplify them.</p>
            <p><span className="font-bold text-white">Max pain</span> is the strike minimising aggregate intrinsic payout — a magnet into front expiry, not a target.</p>
            <p className="text-[10px] text-[#76848a]">OI-inferred dealer convention from the listed chain — not proprietary inventory or executed flow.</p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
