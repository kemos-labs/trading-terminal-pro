/**
 * 3D Greeks surface — lazy-loaded analytical module (restored capability).
 * Loaded ONLY when the user opens the 3D tool (dynamic import from the desk);
 * the initial bundle never pays for three/r3f.
 *
 * Provenance truth (P0):
 * - `grid` is the INTERPOLATED MODEL layer (linear interior + nearest
 *   hole-fill of BSM-derived Greeks). It is never observed provider data.
 * - `observedNodes` are DERIVED per-contract BSM values built without
 *   interpolation (one node per option contract, price_source midpoint/last).
 *   They render as larger distinct markers; missing contracts stay holes.
 * - Unavailable cells stay null everywhere; no NaN/Infinity crosses the boundary.
 * - Diverging Greeks use a zero-centered ramp (v=0 at midpoint); sequential
 *   Greeks map over observed [lo, hi].
 * - ATM ridge (nearest-strike model nodes), camera presets, model level
 *   guides (contours of the model mesh), crosshair + exact hover readout,
 *   keyboard navigation, and DOM axis overlays with exact units.
 * All pure geometry lives in `greeksSurface3dData.ts` (unit-testable, no WebGL).
 */

import { useMemo, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { CHART_RESOLVED } from '../../lib/chartTheme';
import type { SurfaceGrid } from '../../lib/macrovol/api';
import type { GreekKey } from '../views/greeksTypes';
import {
  buildGreekSurface3DData,
  buildGreekWireframeIndices,
  greekValueToHeight,
  rampTDiverging,
  GREEK3D_D,
  GREEK3D_W,
} from './greeksSurface3dData';
import { greekRamp01 } from '../views/greekRamp';

export interface ObservedGreekNode {
  strike: number;
  dte: number;
  value: number;
  price_source?: string;
}

export interface GreeksSurface3DProps {
  grid: SurfaceGrid;
  /** Derived per-contract nodes without interpolation (observed layer). */
  observedNodes?: ObservedGreekNode[];
  spot: number;
  greek: GreekKey;
  label: string;
  unit: string;
  diverging: boolean;
}

interface Readout {
  strike: number;
  dte: number;
  value: number;
  source: 'observed' | 'model';
  price_source?: string;
}

const CAMERA_PRESETS = {
  default: { label: 'Default', position: [3.2, 2.4, 4.2] as [number, number, number] },
  top: { label: 'Top', position: [0, 5.2, 0.15] as [number, number, number] },
  side: { label: 'Side', position: [5.2, 1.2, 0.6] as [number, number, number] },
} as const;

type PresetName = keyof typeof CAMERA_PRESETS;

function GreekPoint({
  x, y, z, color, size, onHover, readout,
}: {
  x: number; y: number; z: number; color: string; size: number;
  onHover: (r: Readout | null) => void;
  readout: Readout;
}) {
  return (
    <mesh
      position={[x, z, y]}
      onPointerOver={(e) => { e.stopPropagation(); onHover(readout); }}
      onPointerOut={() => onHover(null)}
    >
      <sphereGeometry args={[size, 14, 14]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

function GreekSurface3D({ grid, observedNodes, spot, label, unit, diverging }: GreeksSurface3DProps) {
  const [hover, setHover] = useState<Readout | null>(null);
  const [showWire, setShowWire] = useState(false);
  const [showContours, setShowContours] = useState(false);
  const [preset, setPreset] = useState<PresetName>('default');
  const [kbIndex, setKbIndex] = useState<number>(-1);
  const colors = useMemo(() => ({
    foreground: CHART_RESOLVED.foreground,
    brand: CHART_RESOLVED.brand,
    rate: CHART_RESOLVED.rate,
    grid: CHART_RESOLVED.grid,
    gridMinor: CHART_RESOLVED.gridMinor,
  }), []);

  const d = useMemo(() => buildGreekSurface3DData(grid, spot, diverging), [grid, spot, diverging]);

  // Project derived observed nodes into the same 3D normalization as the model
  // layer (no interpolation — one marker per contract).
  const observedProjected = useMemo(() => {
    if (!observedNodes?.length) return [];
    const out: { x: number; y: number; z: number; strike: number; dte: number; value: number; price_source?: string; color: string }[] = [];
    for (const n of observedNodes) {
      if (!Number.isFinite(n.strike) || !Number.isFinite(n.dte) || !Number.isFinite(n.value)) continue;
      const x = d.kMax > d.kMin ? ((n.strike - d.kMin) / (d.kMax - d.kMin)) * GREEK3D_W - GREEK3D_W / 2 : 0;
      const y = d.tMax > d.tMin ? ((n.dte - d.tMin) / (d.tMax - d.tMin)) * GREEK3D_D - GREEK3D_D / 2 : 0;
      const z = greekValueToHeight(n.value, diverging, d.lo, d.hi, d.maxAbs);
      if (z == null) continue;
      const t = diverging ? rampTDiverging(n.value, d.maxAbs) : ((n.value - d.lo) / ((d.hi - d.lo) || 1));
      const c = greekRamp01(Math.max(0, Math.min(1, t)));
      out.push({
        x, y, z,
        strike: n.strike,
        dte: n.dte,
        value: n.value,
        price_source: n.price_source,
        color: `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`,
      });
    }
    return out;
  }, [observedNodes, d, diverging]);

  // Optional interpolated-model wireframe — holes stay holes: indices are
  // emitted only when all four quad corners are present, and heights reuse
  // the exact diverging/sequential ramp used for nodes (no z=0 fabrication,
  // no cross-hole triangles). Labelled explicitly as model, never observed.
  const wireGeometry = useMemo(() => {
    if (!showWire || d.dtes.length < 2 || d.strikes.length < 2) return null;
    const positions: number[] = [];
    for (let ti = 0; ti < d.dtes.length; ti++) {
      const row = d.values[ti];
      for (let ki = 0; ki < d.strikes.length; ki++) {
        const v = row?.[ki];
        const y = ((d.tMax > d.tMin ? ((d.dtes[ti]! - d.tMin) / (d.tMax - d.tMin)) * GREEK3D_D - GREEK3D_D / 2 : 0));
        const tx = ((d.kMax > d.kMin ? ((d.strikes[ki]! - d.kMin) / (d.kMax - d.kMin)) * GREEK3D_W - GREEK3D_W / 2 : 0));
        // Missing cells keep a placeholder vertex but are never indexed, so
        // no triangle can bridge a hole. Height uses the shared ramp.
        const z = greekValueToHeight(v ?? null, diverging, d.lo, d.hi, d.maxAbs) ?? 0;
        positions.push(tx, z, y);
      }
    }
    const idx = buildGreekWireframeIndices(d.values);
    if (idx.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }, [showWire, d, diverging]);

  // Keyboard navigation through observed nodes (fallback to model nodes).
  const kbPool = observedProjected.length ? observedProjected : d.points.map((p) => ({ ...p, price_source: undefined as string | undefined }));
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!kbPool.length) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (kbIndex + 1 + kbPool.length) % kbPool.length;
      setKbIndex(next);
      const n = kbPool[next]!;
      setHover({
        strike: n.strike,
        dte: n.dte,
        value: n.value,
        source: observedProjected.length ? 'observed' : 'model',
        price_source: (n as { price_source?: string }).price_source,
      });
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = (kbIndex - 1 + kbPool.length) % kbPool.length;
      setKbIndex(next);
      const n = kbPool[next]!;
      setHover({
        strike: n.strike,
        dte: n.dte,
        value: n.value,
        source: observedProjected.length ? 'observed' : 'model',
        price_source: (n as { price_source?: string }).price_source,
      });
    } else if (e.key === 'Escape') {
      setHover(null);
      setKbIndex(-1);
    }
  }, [kbPool, kbIndex, observedProjected.length]);

  if (!d.hasObserved) {
    return (
      <div className="relative h-full min-h-[320px] w-full" data-testid="greeks-surface-3d">
        <div className="absolute inset-0 flex items-center justify-center font-mono text-type-2xs text-muted-foreground">
          No model {label} cells in this surface — 3D stays unavailable at every node.
        </div>
      </div>
    );
  }

  const nodeColor = (c: [number, number, number]) =>
    `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

  return (
    <div
      className="relative h-full min-h-[320px] w-full"
      data-testid="greeks-surface-3d"
      tabIndex={0}
      role="application"
      aria-label={`${label} 3D surface. Arrow keys move through ${observedProjected.length ? 'observed contract' : 'model'} nodes, Escape clears the readout.`}
      onKeyDown={onKeyDown}
    >
      <Canvas
        key={preset}
        camera={{ position: CAMERA_PRESETS[preset].position, fov: 42 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
        onCreated={({ gl }) => gl.setClearColor('#0a0e18')}
      >
        <color attach="background" args={[colors.grid]} />
        <OrbitControls enableDamping dampingFactor={0.08} />
        <gridHelper args={[Math.max(GREEK3D_W, GREEK3D_D) * 1.2, 10, colors.foreground, colors.gridMinor]} />

        {/* Model layer — small ramp-colored nodes from the interpolated grid */}
        {d.points.map((p) => (
          <GreekPoint
            key={`m-${p.dte}-${p.strike}`}
            x={p.x}
            y={p.y}
            z={p.z}
            color={nodeColor(p.color)}
            size={0.035}
            onHover={setHover}
            readout={{ strike: p.strike, dte: p.dte, value: p.value, source: 'model' }}
          />
        ))}

        {/* Observed layer — larger distinct markers, one per derived contract (no interpolation) */}
        {observedProjected.map((p) => (
          <GreekPoint
            key={`o-${p.dte}-${p.strike}`}
            x={p.x}
            y={p.y}
            z={p.z}
            color={p.color}
            size={0.06}
            onHover={setHover}
            readout={{ strike: p.strike, dte: p.dte, value: p.value, source: 'observed', price_source: p.price_source }}
          />
        ))}

        {d.atmRidge.map((p, i) => (
          <mesh key={`ridge-${i}`} position={[p.x, p.z, p.y]}>
            <sphereGeometry args={[0.06, 10, 10]} />
            <meshBasicMaterial color={colors.brand} />
          </mesh>
        ))}
        <mesh position={[d.atmX, 0.002, 0]}>
          <boxGeometry args={[0.012, 0.004, GREEK3D_D]} />
          <meshBasicMaterial color={colors.brand} transparent opacity={0.8} />
        </mesh>

        {wireGeometry && (
          <mesh geometry={wireGeometry}>
            <meshBasicMaterial color={colors.rate} wireframe transparent opacity={0.4} />
          </mesh>
        )}

        {/* Model level guides (contours): honest horizontal references at Z ticks */}
        {showContours && d.zTicks.map((v) => {
          const z = greekValueToHeight(v, diverging, d.lo, d.hi, d.maxAbs);
          if (z == null) return null;
          return (
            <mesh key={`contour-${v}`} position={[0, z, 0]}>
              <boxGeometry args={[GREEK3D_W, 0.004, GREEK3D_D]} />
              <meshBasicMaterial color={colors.foreground} transparent opacity={0.22} />
            </mesh>
          );
        })}

        {/* Crosshair at hovered node: vertical stem + floor marker */}
        {hover && (
          <group>
            <mesh position={[
              d.kMax > d.kMin ? ((hover.strike - d.kMin) / (d.kMax - d.kMin)) * GREEK3D_W - GREEK3D_W / 2 : 0,
              (greekValueToHeight(hover.value, diverging, d.lo, d.hi, d.maxAbs) ?? 0) / 2,
              d.tMax > d.tMin ? ((hover.dte - d.tMin) / (d.tMax - d.tMin)) * GREEK3D_D - GREEK3D_D / 2 : 0,
            ]}>
              <boxGeometry args={[0.008, greekValueToHeight(hover.value, diverging, d.lo, d.hi, d.maxAbs) ?? 0.1, 0.008]} />
              <meshBasicMaterial color={colors.brand} />
            </mesh>
          </group>
        )}
      </Canvas>

      {/* DOM overlay: axes with exact units, Z ticks, legend, hover readout */}
      <div className="pointer-events-none absolute inset-0 font-mono text-type-2xs text-muted-foreground">
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2">Strike ($)&nbsp;→</span>
        <span className="absolute right-1 top-1/2 -translate-y-1/2 rotate-90">DTE (days)&nbsp;→</span>
        <div className="absolute left-1 top-2 flex flex-col gap-0.5">
          <span className="font-semibold text-foreground">{label} ({unit})</span>
          {d.zTicks.map((v) => (
            <span key={v} className="tabular-nums">{v.toFixed(4)}</span>
          ))}
        </div>
        <div className="absolute left-1 top-1/2 flex flex-col gap-0.5">
          {hover && (
            <span className="rounded bg-card/80 px-1.5 py-0.5 text-foreground" data-testid="greeks-3d-readout">
              {hover.source === 'observed' ? 'OBS' : 'MODEL'} K {hover.strike.toFixed(0)} · {hover.dte}d · {hover.value.toFixed(4)} {unit}{hover.price_source ? ` · ${hover.price_source}` : ''}
            </span>
          )}
        </div>
        <span className="absolute bottom-1 left-1 flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: colors.brand }} aria-hidden />
          observed contracts ({observedProjected.length})
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: colors.foreground }} aria-hidden />
          model grid ({d.points.length})
          <span className="inline-block h-1.5 w-1.5" style={{ background: colors.brand }} aria-hidden />
          ATM ridge
          {showWire && (
            <>
              <span className="inline-block h-px w-4" style={{ background: colors.rate }} aria-hidden />
              model mesh (interpolated)
            </>
          )}
          {showContours && (
            <>
              <span className="inline-block h-px w-4" style={{ background: colors.foreground }} aria-hidden />
              level guides
            </>
          )}
        </span>
      </div>

      {/* Explicit controls: model mesh, contours, camera presets. Keyboard: arrows + Escape. */}
      <div className="absolute top-2 right-2 flex flex-wrap justify-end gap-1">
        <button
          type="button"
          data-testid="greeks-3d-wireframe-toggle"
          aria-pressed={showWire}
          onClick={() => setShowWire((s) => !s)}
          className="rounded border border-border bg-card px-2 py-1 font-mono text-type-2xs text-foreground hover:bg-muted/30 focus-ring-term"
        >
          {showWire ? 'Hide' : 'Show'} model mesh
        </button>
        <button
          type="button"
          data-testid="greeks-3d-contours-toggle"
          aria-pressed={showContours}
          onClick={() => setShowContours((s) => !s)}
          className="rounded border border-border bg-card px-2 py-1 font-mono text-type-2xs text-foreground hover:bg-muted/30 focus-ring-term"
        >
          {showContours ? 'Hide' : 'Show'} contours
        </button>
        {(Object.keys(CAMERA_PRESETS) as PresetName[]).map((name) => (
          <button
            key={name}
            type="button"
            data-testid={`greeks-3d-preset-${name}`}
            aria-pressed={preset === name}
            onClick={() => setPreset(name)}
            className="rounded border border-border bg-card px-2 py-1 font-mono text-type-2xs text-foreground hover:bg-muted/30 focus-ring-term"
          >
            {CAMERA_PRESETS[name].label}
          </button>
        ))}
      </div>
      <span className="sr-only" data-testid="greeks-3d-fallback-note">
        2D strike and term profiles plus exact tables above are the accessible fallback for this Canvas.
      </span>
    </div>
  );
}

export default GreekSurface3D;
