/**
 * Top-of-desk plumbing barometer — SOFR−EFFR, RRP, reserves, IORB, regime chip.
 * Conks / OnlySOFRs mental model; public FRED data only.
 */
import type { ReactNode } from 'react';
import type { BasisData, PlumbingData, RatesSummary } from '../../../lib/macrovol/api';
import {
  classifyPlumbingRegime,
  sofrEffrBps,
} from '../../../lib/rates/plumbingRegime';
import { Explain } from '../../common/Explain';
import { cn } from '../../../lib/utils';

function fmtRate(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(2)}%`;
}

function fmtBps(bps: number | null): string {
  if (bps == null || !Number.isFinite(bps)) return '—';
  const sign = bps > 0 ? '+' : '';
  return `${sign}${bps.toFixed(1)}bp`;
}

function fmtBn(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(2)}T`;
  return `$${v.toFixed(0)}B`;
}

export function PlumbingBarometer({
  plumbing,
  basis,
  summary,
}: {
  plumbing: PlumbingData | null;
  basis: BasisData | null;
  summary?: RatesSummary | null;
}) {
  const sofr = basis?.sofr ?? plumbing?.sofr ?? summary?.sofr ?? null;
  const effr = basis?.effr ?? plumbing?.effr ?? summary?.effr ?? null;
  const iorb = basis?.iorb ?? plumbing?.iorb ?? null;
  const rrpRate = plumbing?.rrp_rate ?? null;
  const rrpVol = plumbing?.rrp_volume_latest ?? null;
  const reservesBn =
    plumbing?.wresbal_history?.length
      ? plumbing.wresbal_history[plumbing.wresbal_history.length - 1]!.reserves
      : null;

  const seBps =
    basis?.sofr_effr != null && Number.isFinite(basis.sofr_effr)
      ? basis.sofr_effr
      : sofrEffrBps(sofr, effr);

  const regime = classifyPlumbingRegime({
    sofr,
    effr,
    iorb,
    rrpRate,
    rrpVolumeBn: rrpVol,
    reservesBn,
  });

  const toneCls =
    regime.tone === 'up'
      ? 'border-up/40 bg-up/10 text-up'
      : regime.tone === 'down'
        ? 'border-down/40 bg-down/10 text-down'
        : regime.tone === 'warn'
          ? 'border-warn/40 bg-warn/10 text-warn'
          : 'border-border bg-card/50 text-muted-foreground';

  const hierarchy = [
    { label: 'RRP floor', rate: rrpRate, hint: 'Fed reverse repo — cash park floor' },
    { label: 'Private repo', rate: sofr, hint: 'SOFR ≈ secured private ON complex' },
    { label: 'EFFR', rate: effr, hint: 'Unsecured fed funds effective' },
    { label: 'IORB', rate: iorb, hint: 'Interest on reserves' },
  ];

  return (
    <div
      className="rounded-lg border border-border bg-card/40 px-2 py-1.5 font-mono"
      role="region"
      aria-label="Plumbing barometer"
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="text-type-2xs font-semibold tracking-wide text-muted-foreground">
          PLUMBING BAROMETER
        </span>
        <span
          className={cn('rounded border px-1.5 py-0.5 text-type-2xs font-bold', toneCls)}
          title={regime.note}
        >
          <Explain term="plumbingRegime">{regime.short}</Explain>
          <span className="ml-1 font-normal opacity-90">{regime.label}</span>
        </span>
        <span className="ml-auto text-type-2xs text-muted-foreground">
          FRED · public prints · not G-SIB
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
        <Metric
          label={<Explain term="sofrEffr">SOFR−EFFR</Explain>}
          value={fmtBps(seBps)}
          emphasize
          tone={seBps != null && seBps > 5 ? 'warn' : 'neutral'}
        />
        <Metric label="SOFR" value={fmtRate(sofr)} />
        <Metric label="EFFR" value={fmtRate(effr)} />
        <Metric label="IORB" value={fmtRate(iorb)} />
        <Metric label="RRP bal" value={fmtBn(rrpVol)} />
        <Metric label="Reserves" value={fmtBn(reservesBn)} />
      </div>

      {/* Repo hierarchy strip */}
      <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border/50 pt-1.5">
        <span className="mr-1 text-type-2xs text-muted-foreground">Hierarchy</span>
        {hierarchy.map((h, i) => (
          <span key={h.label} className="flex items-center gap-1">
            {i > 0 && <span className="text-muted-foreground">→</span>}
            <span
              className="rounded border border-border/60 bg-background/40 px-1.5 py-0.5 text-type-2xs"
              title={h.hint}
            >
              <span className="text-muted-foreground">{h.label} </span>
              <span className="tabular-nums text-foreground">{fmtRate(h.rate)}</span>
            </span>
          </span>
        ))}
        <span className="text-type-2xs text-muted-foreground">→ SRF ceiling</span>
      </div>

      <p className="mt-1 text-type-2xs leading-snug text-muted-foreground">
        {regime.note}
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  emphasize,
  tone = 'neutral',
}: {
  label: ReactNode;
  value: string;
  emphasize?: boolean;
  tone?: 'neutral' | 'warn';
}) {
  return (
    <div
      className={cn(
        'rounded border px-2 py-1',
        emphasize ? 'border-primary/30 bg-primary/5' : 'border-border/60 bg-background/30',
      )}
    >
      <div className="text-type-2xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          'text-sm font-semibold tabular-nums',
          tone === 'warn' ? 'text-warn' : 'text-foreground',
        )}
      >
        {value}
      </div>
    </div>
  );
}
