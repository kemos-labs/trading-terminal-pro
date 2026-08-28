/**
 * Read-only multi-leg strategy builder — net mid + greeks + BEs from live chain.
 * Full toolkit lives on MM Desk; this is the Home / Positioning quick ticket.
 */
import { useMemo, useState } from 'react';
import { useTerminalStore } from '../../store/terminalStore';
import {
  breakEvenSpots,
  evaluateCombo,
  templateLegs,
  type PortfolioLeg,
  type TemplateName,
} from '../../lib/options/portfolio';
import { fmtPrice, fmtSigned } from '../../lib/format';
import { cn } from '../../lib/utils';
import { Explain } from './Explain';

const TEMPLATES: { id: TemplateName; label: string; term?: string }[] = [
  { id: 'long_straddle', label: 'Long straddle' },
  { id: 'short_straddle', label: 'Short straddle', term: 'shortStraddle' },
  { id: 'collar', label: 'Collar ~25Δ', term: 'collar' },
  { id: 'call_spread', label: 'Call spread' },
  { id: 'risk_reversal', label: 'Risk reversal' },
  { id: 'long_call', label: 'Long call' },
  { id: 'short_put', label: 'Short put' },
];

export function StrategyBuilderStrip({ className }: { className?: string }) {
  const snapshot = useTerminalStore((s) => s.snapshot);
  const chainUsed = useTerminalStore((s) => s.chainUsed);
  const [tpl, setTpl] = useState<TemplateName>('long_straddle');
  const [expiryIdx, setExpiryIdx] = useState(0);

  const legs: PortfolioLeg[] = useMemo(() => {
    if (!snapshot?.expiries?.length) return [];
    const idx = Math.min(expiryIdx, snapshot.expiries.length - 1);
    return templateLegs(tpl, snapshot, idx);
  }, [snapshot, tpl, expiryIdx]);

  const mark = useMemo(() => {
    if (!snapshot || !legs.length) return null;
    return evaluateCombo(legs, snapshot);
  }, [snapshot, legs]);

  const bes = useMemo(() => {
    if (!snapshot || !legs.length) return [];
    const res = breakEvenSpots(legs, snapshot.spot, 0.7, 1.3, 300);
    return res.available ? res.breakEvens.slice(0, 3) : [];
  }, [snapshot, legs]);

  if (!snapshot) {
    return (
      <div className={cn('rounded border border-border px-2 py-1.5 font-mono text-type-2xs text-muted-foreground', className)}>
        Strategy builder — load a chain first
      </div>
    );
  }

  return (
    <div className={cn('rounded border border-border bg-card/60 font-mono', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-2 py-1">
        <span className="text-type-xs font-semibold text-foreground">Strategy</span>
        <span className="text-type-2xs text-muted-foreground">
          read-only · mid + BS greeks · chain {chainUsed || '—'}
        </span>
        <select
          className="rounded border border-border bg-background px-1 py-0.5 text-type-2xs"
          value={tpl}
          onChange={(e) => setTpl(e.target.value as TemplateName)}
        >
          {TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        {TEMPLATES.find((t) => t.id === tpl)?.term && (
          <Explain term={TEMPLATES.find((t) => t.id === tpl)!.term!}>
            <span className="text-type-2xs text-cyan">what is this?</span>
          </Explain>
        )}
        <select
          className="rounded border border-border bg-background px-1 py-0.5 text-type-2xs"
          value={expiryIdx}
          onChange={(e) => setExpiryIdx(Number(e.target.value))}
        >
          {snapshot.expiries.slice(0, 8).map((ex, i) => (
            <option key={ex.expiry} value={i}>
              {ex.dte}d · {ex.expiry}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Mark" value={mark ? fmtPrice(mark.mark) : '—'} />
        <Stat label="Δ PnL vs entry" value={mark?.pnl != null ? fmtSigned(mark.pnl) : '—'} tone={mark?.pnl != null && mark.pnl >= 0 ? 'up' : 'down'} />
        <Stat label="Δ" value={mark ? mark.greeks.delta.toFixed(3) : '—'} />
        <Stat label="Γ" value={mark ? mark.greeks.gamma.toFixed(4) : '—'} />
        <Stat label="ν" value={mark ? mark.greeks.vega.toFixed(3) : '—'} />
        <Stat label="θ" value={mark ? mark.greeks.theta.toFixed(3) : '—'} />
      </div>
      <div className="border-t border-border/40 px-2 py-1 text-type-2xs text-muted-foreground">
        Legs:{' '}
        {legs.map((l) => (
          <span key={l.id} className="mr-2">
            {l.side} {l.qty} {l.kind} {l.strike} @ {l.entryPrice != null ? fmtPrice(l.entryPrice) : 'Unavailable'}
          </span>
        ))}
        {bes.length > 0 && (
          <span className="ml-2 text-foreground">
            BE {bes.map((b) => fmtPrice(b, 1)).join(' · ')}
          </span>
        )}
        <span className="ml-2">· full sim on MM Desk</span>
      </div>
    </div>
  );
}

function Stat({
  label, value, tone,
}: {
  label: string; value: string; tone?: 'up' | 'down';
}) {
  return (
    <div className="min-w-0">
      <div className="text-type-2xs text-muted-foreground">{label}</div>
      <div className={cn(
        'tabular-nums text-type-sm font-semibold',
        tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-foreground',
      )}>
        {value}
      </div>
    </div>
  );
}
