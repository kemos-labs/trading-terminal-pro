import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useTerminalStore } from '../../../store/terminalStore';
import { sviReadoutsByExpiry } from '../../../lib/options/surfaceTools';
import { fmtPrice } from '../../../lib/format';
import { cn } from '../../../lib/utils';
import type { Surf3DXMode, Surf3DPreset } from '../../charts/surface3dModel';

/**
 * Vol · Surface — 3D IV surface entry (Phase 4).
 * The 3D engine (three/r3f) is dynamically imported ONLY when the user opens
 * this tool; the initial bundle never pays for it. Observed matrix remains the
 * default 2D view with the model layer explicitly separated.
 */

const IvSurface3D = lazy(() => import('../../charts/IvSurface3D'));

export function Surface3DTool() {
  const surface = useTerminalStore((s) => s.surface);
  const snapshot = useTerminalStore((s) => s.snapshot);
  const [showModel, setShowModel] = useState(true);
  const [solid, setSolid] = useState(true);
  const [xMode, setXMode] = useState<Surf3DXMode>('strike');
  const [preset, setPreset] = useState<Surf3DPreset>('home');
  const [hover, setHover] = useState<{ strike: number; dte: number; iv: number | null; source: string } | null>(null);

  const sviFits = useMemo(
    () => (surface && snapshot ? sviReadoutsByExpiry(surface, snapshot.spot) : []),
    [surface, snapshot],
  );

  // Keyboard toggle: M = model layer, Esc clears hover.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'm' || e.key === 'M') setShowModel((v) => !v);
      if (e.key === 'Escape') setHover(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!surface || !snapshot) {
    return (
      <div className="flex h-64 items-center justify-center rounded border border-border bg-black/40 font-mono text-type-2xs text-muted-foreground" data-testid="surface-3d-empty">
        No surface — load a live chain first (no synthetic 3D).
      </div>
    );
  }

  const fitMeta = sviFits.length
    ? `SVI fits: ${sviFits.length} expiries · median RMSE ${(sviFits.reduce((s, f) => s + f.rmse, 0) / sviFits.length * 100).toFixed(2)} vol pts`
    : 'SVI model unavailable for this chain';

  return (
    <div className="flex h-[420px] min-h-0 flex-col gap-1 rounded border border-border bg-black/40 p-1.5" data-testid="surface-3d-tool">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 font-mono text-type-2xs">
        <span className="font-semibold tracking-wider text-foreground">
          IV SURFACE 3D · observed nodes + model mesh
          <span className="ml-2 font-normal text-muted-foreground">{snapshot.symbol} · spot {fmtPrice(snapshot.spot, 2)}</span>
        </span>
        <span className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowModel((v) => !v)}
            aria-pressed={showModel}
            className={cn(
              'rounded border px-1.5 py-0.5 font-mono transition-colors',
              showModel ? 'border-primary/60 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {showModel ? 'Model: ON (M)' : 'Model: OFF (M)'}
          </button>
          <button
            type="button"
            onClick={() => setSolid((v) => !v)}
            aria-pressed={solid}
            title="Shaded solid mesh vs wireframe"
            className={cn(
              'rounded border px-1.5 py-0.5 font-mono transition-colors',
              solid ? 'border-primary/60 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {solid ? 'Solid' : 'Wire'}
          </button>
          <button
            type="button"
            onClick={() => setXMode((m) => (m === 'strike' ? 'moneyness' : 'strike'))}
            aria-pressed={xMode === 'moneyness'}
            title="Strike axis vs symmetric log-moneyness wings (ATM centered)"
            className="rounded border border-border px-1.5 py-0.5 font-mono text-muted-foreground transition-colors hover:text-foreground"
          >
            {xMode === 'strike' ? 'Strike' : 'ln(K/F)'}
          </button>
          {(['home', 'top', 'side'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              aria-pressed={preset === p}
              title={`Camera preset: ${p}`}
              className={cn(
                'rounded border px-1.5 py-0.5 font-mono capitalize transition-colors',
                preset === p ? 'border-primary/60 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {p}
            </button>
          ))}
          <span className="text-muted-foreground">{fitMeta}</span>
        </span>
      </div>

      <div className="min-h-0 flex-1">
        <Suspense fallback={<div className="flex h-full items-center justify-center font-mono text-type-2xs text-muted-foreground">Loading 3D engine…</div>}>
          <IvSurface3D
            key={`${xMode}-${preset}`}
            grid={surface}
            spot={snapshot.spot}
            sviFits={sviFits}
            showModel={showModel}
            solid={solid}
            xMode={xMode}
            viewPreset={preset}
            onHover={setHover}
          />
        </Suspense>
      </div>

      {/* Exact hover readout + accessible table pointer */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-1 font-mono text-type-2xs">
        <span data-testid="surface-3d-hover" className="tabular-nums text-foreground">
          {hover
            ? `${hover.source}: K ${fmtPrice(hover.strike, hover.strike > 1000 ? 0 : 2)} · ${hover.dte}d · IV ${hover.iv != null ? (hover.iv * 100).toFixed(2) + '%' : 'unavailable'}`
            : 'Hover a node for exact values · drag to orbit · M toggles model mesh'}
        </span>
        <span className="text-muted-foreground">Z axis: IV vol points · missing observations are holes (never interpolated)</span>
      </div>
    </div>
  );
}
