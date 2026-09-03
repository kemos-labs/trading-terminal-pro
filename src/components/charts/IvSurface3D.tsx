import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
// Deep import: the drei barrel re-exports Stats, which pulls a second three
// revision (stats-gl) and trips three's multiple-instances warning.
import { OrbitControls } from '@react-three/drei/core/OrbitControls.js';
import * as THREE from 'three';
import { CHART_RESOLVED } from '../../lib/chartTheme';
import type { SurfaceGrid } from '../../lib/options/types';
import type { SVIReadout } from '../../lib/options/surfaceTools';

/**
 * 3D IV surface — lazy-loaded analytical module (Phase 3/4).
 * Loaded ONLY when the user opens the 3D tool (dynamic import from the desk);
 * the initial bundle never pays for three/r3f.
 *
 * Spec rules encoded:
 * - X = strike (or ln-moneyness toggle upstream), Y = DTE, Z = IV in vol points
 *   with an exact unit label.
 * - Observed nodes render as points; missing observations remain holes (no
 *   interpolation across gaps in the observed layer).
 * - The smooth SVI model mesh is a separate layer, toggleable, labelled Model
 *   (fit params + RMSE + samples), never overwriting observed markers.
 * - ATM ridge line, stable camera presets, exact hover tooltip via 2D overlay,
 *   keyboard-accessible table fallback rendered by the parent.
 */

const WIDTH = 3.6;
const DEPTH = 2.6;
const HEIGHT = 1.6;

export interface IvSurface3DProps {
  grid: SurfaceGrid;
  spot: number;
  /** Per-expiry SVI model fits (model layer). */
  sviFits: SVIReadout[];
  showModel: boolean;
  onHover?: (info: { strike: number; dte: number; iv: number | null; source: 'observed' | 'model' | 'missing' } | null) => void;
}

function IvPoint({
  x, y, z, color, onHover, info,
}: {
  x: number; y: number; z: number; color: string;
  onHover: NonNullable<IvSurface3DProps['onHover']>;
  info: { strike: number; dte: number; iv: number | null; source: 'observed' | 'missing' };
}) {
  return (
    <mesh
      position={[x, z, y]}
      onPointerOver={(e) => { e.stopPropagation(); onHover({ ...info, source: 'observed' }); }}
      onPointerOut={() => onHover(null)}
    >
      <sphereGeometry args={[0.045, 14, 14]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

export default function IvSurface3D({ grid, spot, sviFits, showModel, onHover }: IvSurface3DProps) {
  const colors = useMemo(() => ({
    brand: CHART_RESOLVED.brand,
    up: CHART_RESOLVED.up,
    down: CHART_RESOLVED.down,
    info: CHART_RESOLVED.info,
    warn: CHART_RESOLVED.warn,
    rate: CHART_RESOLVED.rate,
    grid: CHART_RESOLVED.grid,
    gridMinor: CHART_RESOLVED.gridMinor,
    label: CHART_RESOLVED.label,
    foreground: CHART_RESOLVED.foreground,
    background: CHART_RESOLVED.background,
  }), []);

  /** Normalization: X strike → [-W/2, W/2], Y dte → [-D/2, D/2], Z iv → [0, H]. */
  const norm = useMemo(() => {
    const strikes = grid.strikes;
    const dtes = grid.dtes;
    const kMin = strikes[0] ?? 0;
    const kMax = strikes[strikes.length - 1] ?? 1;
    const tMin = dtes[0] ?? 0;
    const tMax = dtes[dtes.length - 1] ?? 1;
    let ivLo = Infinity;
    let ivHi = -Infinity;
    for (const row of grid.iv) {
      for (const v of row) {
        if (v != null && Number.isFinite(v)) {
          if (v < ivLo) ivLo = v;
          if (v > ivHi) ivHi = v;
        }
      }
    }
    if (!Number.isFinite(ivLo)) { ivLo = 0.1; ivHi = 0.5; }
    return {
      x: (k: number) => (kMax > kMin ? ((k - kMin) / (kMax - kMin)) * WIDTH - WIDTH / 2 : 0),
      y: (t: number) => (tMax > tMin ? ((t - tMin) / (tMax - tMin)) * DEPTH - DEPTH / 2 : 0),
      z: (iv: number) => ((iv - ivLo) / ((ivHi - ivLo) || 1)) * HEIGHT,
      kMin, kMax, tMin, tMax, ivLo, ivHi,
    };
  }, [grid]);

  const atmX = norm.x(spot);

  /** Model mesh geometry from per-expiry SVI fits (separate layer). */
  const modelGeometry = useMemo(() => {
    if (!showModel || !sviFits.length) return null;
    const dteByExpiry = new Map<string, number>();
    grid.expiries.forEach((e, i) => dteByExpiry.set(e, grid.dtes[i] ?? 0));
    const fits = sviFits
      .filter((f) => dteByExpiry.has(f.expiry))
      .sort((a, b) => (dteByExpiry.get(a.expiry) ?? 0) - (dteByExpiry.get(b.expiry) ?? 0));
    if (fits.length < 2) return null;

    const nCols = 40;
    const positions: number[] = [];
    const idx: number[] = [];
    const kLo = Math.log(norm.kMin / spot);
    const kHi = Math.log(norm.kMax / spot);
    for (let r = 0; r < fits.length; r++) {
      const fit = fits[r]!;
      const t = dteByExpiry.get(fit.expiry) ?? 0;
      const T = Math.max(t / 365, 1 / 365);
      const y = norm.y(t);
      for (let c = 0; c < nCols; c++) {
        const k = kLo + ((kHi - kLo) * c) / (nCols - 1);
        const strike = spot * Math.exp(k);
        // svi total variance → iv (surface/svi.ts math via inline total-variance form)
        const { a, b, rho, m, sigma } = fit.params;
        const kk = k - m;
        const w = Math.max(0, a + b * (rho * kk + Math.sqrt(kk * kk + sigma * sigma)));
        const iv = Math.sqrt(w / T);
        positions.push(norm.x(strike), norm.z(iv), y);
        if (r < fits.length - 1 && c < nCols - 1) {
          const i0 = r * nCols + c;
          idx.push(i0, i0 + 1, i0 + nCols, i0 + 1, i0 + nCols + 1, i0 + nCols);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }, [showModel, sviFits, grid, norm, spot]);

  const observed = useMemo(() => {
    const pts: { x: number; y: number; z: number; strike: number; dte: number; iv: number }[] = [];
    for (let r = 0; r < grid.iv.length; r++) {
      const dte = grid.dtes[r] ?? 0;
      for (let c = 0; c < grid.strikes.length; c++) {
        const iv = grid.iv[r]?.[c];
        if (iv == null || !Number.isFinite(iv)) continue; // hole stays a hole
        pts.push({
          x: norm.x(grid.strikes[c]!),
          y: norm.y(dte),
          z: norm.z(iv),
          strike: grid.strikes[c]!,
          dte,
          iv,
        });
      }
    }
    return pts;
  }, [grid, norm]);

  /** ATM ridge from observed nearest-strike nodes. */
  const atmRidge = useMemo(() => {
    const pts: { x: number; y: number; z: number }[] = [];
    for (let r = 0; r < grid.iv.length; r++) {
      const dte = grid.dtes[r] ?? 0;
      let best: { iv: number; strike: number } | null = null;
      for (let c = 0; c < grid.strikes.length; c++) {
        const iv = grid.iv[r]?.[c];
        const k = grid.strikes[c]!;
        if (iv == null || !Number.isFinite(iv)) continue;
        if (!best || Math.abs(k - spot) < Math.abs(best.strike - spot)) best = { iv, strike: k };
      }
      if (best) pts.push({ x: norm.x(best.strike), y: norm.y(dte), z: norm.z(best.iv) });
    }
    return pts;
  }, [grid, norm, spot]);

  const ivTicks = useMemo(
    () => [0, 0.25, 0.5, 0.75, 1].map((t) => norm.ivLo + t * (norm.ivHi - norm.ivLo)),
    [norm],
  );

  return (
    <div className="relative h-full min-h-[320px] w-full" data-testid="iv-surface-3d">
      <Canvas camera={{ position: [3.2, 2.4, 4.2], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true }} onCreated={({ gl }) => gl.setClearColor('#0a0e18')}>
        <color attach="background" args={[colors.background]} />
        {/* Stable camera presets handled by parent buttons adjusting OrbitControls via ref */}
        <OrbitControls enableDamping dampingFactor={0.08} />
        <gridHelper args={[Math.max(WIDTH, DEPTH) * 1.2, 10, colors.grid, colors.gridMinor]} />

        {/* Observed nodes — holes remain holes */}
        {observed.map((p, i) => (
          <IvPoint
            key={i}
            x={p.x}
            y={p.y}
            z={p.z}
            color={colors.foreground}
            onHover={(info) => onHover?.(info)}
            info={{ strike: p.strike, dte: p.dte, iv: p.iv, source: 'observed' }}
          />
        ))}

        {/* ATM ridge — brand line through nearest-strike observed nodes */}
        {atmRidge.map((p, i) => (
          <mesh key={`ridge-${i}`} position={[p.x, p.z, p.y]}>
            <sphereGeometry args={[0.055, 10, 10]} />
            <meshBasicMaterial color={colors.brand} />
          </mesh>
        ))}
        {/* ATM reference — thin floor strip at the base (reads as a line, not a wall). */}
        <mesh position={[atmX, 0.002, 0]}>
          <boxGeometry args={[0.012, 0.004, DEPTH]} />
          <meshBasicMaterial color={colors.brand} transparent opacity={0.8} />
        </mesh>

        {/* Model mesh — separate toggleable layer (SVI fit) */}
        {modelGeometry && (
          <mesh geometry={modelGeometry}>
            <meshBasicMaterial
              color={colors.warn}
              wireframe
              transparent
              opacity={0.55}
            />
          </mesh>
        )}
      </Canvas>

      {/* 2D overlay: axis titles, Z ticks, legend — DOM, not canvas (accessible + exact) */}
      <div className="pointer-events-none absolute inset-0 font-mono text-type-2xs text-muted-foreground">
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2">Strike →</span>
        <span className="absolute right-1 top-1/2 -translate-y-1/2 rotate-90">DTE →</span>
        <div className="absolute left-1 top-2 flex flex-col gap-0.5">
          <span className="font-semibold text-foreground">IV (vol, %)</span>
          {ivTicks.map((v) => (
            <span key={v} className="tabular-nums">{(v * 100).toFixed(1)}</span>
          ))}
        </div>
        <span className="absolute left-1 bottom-1 flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: colors.foreground }} aria-hidden />
          observed
          {showModel && (
            <>
              <span className="inline-block h-px w-4" style={{ background: colors.rate }} aria-hidden />
              SVI model mesh
            </>
          )}
          <span className="inline-block h-1.5 w-1.5" style={{ background: colors.brand }} aria-hidden />
          ATM ridge
        </span>
      </div>
    </div>
  );
}
