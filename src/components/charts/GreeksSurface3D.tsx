/**
 * 3D Greeks surface — lazy-loaded analytical module (restored capability).
 * Loaded ONLY when the user opens the 3D tool (dynamic import from the desk);
 * the initial bundle never pays for three/r3f.
 *
 * Spec rules encoded:
 * - X = strike, Y = DTE, Z = Greek value with an exact unit label.
 * - Observed nodes render as points; missing observations remain holes (no
 *   interpolation across gaps in the observed layer).
 * - No fabricated "model" layer: the canonical Greeks service publishes only
 *   observed grids, so there is no smooth model fit to display. The optional
 *   observed wireframe is explicitly labeled as an interpolation view of
 *   observed cells, never as a fitted model.
 * - Diverging Greeks use a zero-centered cyan→white→amber ramp; sequential
 *   Greeks use the same ramp over the observed min/max.
 * - ATM ridge (nearest-strike observed nodes) and exact hover readout via DOM
 *   overlay; 2D profiles and an accessible table fallback render in the parent.
 * All pure geometry lives in `greeksSurface3dData.ts` (unit-testable, no WebGL).
 */

import { useMemo, useState } from 'react';
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
  GREEK3D_D,
  GREEK3D_H,
  GREEK3D_W,
} from './greeksSurface3dData';

export interface GreeksSurface3DProps {
  grid: SurfaceGrid;
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
}

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

function GreekSurface3D({ grid, spot, label, unit, diverging }: GreeksSurface3DProps) {
  const [hover, setHover] = useState<Readout | null>(null);
  const [showWire, setShowWire] = useState(false);
  const colors = useMemo(() => ({
    foreground: CHART_RESOLVED.foreground,
    brand: CHART_RESOLVED.brand,
    rate: CHART_RESOLVED.rate,
    grid: CHART_RESOLVED.grid,
    gridMinor: CHART_RESOLVED.gridMinor,
  }), []);

  const d = useMemo(() => buildGreekSurface3DData(grid, spot, diverging), [grid, spot, diverging]);

  // Optional interpolated-model wireframe — holes stay holes: indices are
  // emitted only when all four quad corners are present, and heights reuse
  // the exact diverging/sequential ramp used for observed nodes (no z=0
  // fabrication, no cross-hole triangles). Labelled explicitly as an
  // interpolation view of the grid, never as observed cells.
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

  if (!d.hasObserved) {
    return (
      <div className="relative h-full min-h-[320px] w-full" data-testid="greeks-surface-3d">
        <div className="absolute inset-0 flex items-center justify-center font-mono text-type-2xs text-muted-foreground">
          No observed {label} cells in this surface — 3D stays unavailable at every node.
        </div>
      </div>
    );
  }

  const nodeColor = (c: [number, number, number]) =>
    `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

  return (
    <div className="relative h-full min-h-[320px] w-full" data-testid="greeks-surface-3d">
      <Canvas camera={{ position: [3.2, 2.4, 4.2], fov: 42 }} dpr={[1, 2]} gl={{ antialias: true }} onCreated={({ gl }) => gl.setClearColor('#0a0e18')}>
        <color attach="background" args={[colors.grid]} />
        <OrbitControls enableDamping dampingFactor={0.08} />
        <gridHelper args={[Math.max(GREEK3D_W, GREEK3D_D) * 1.2, 10, colors.foreground, colors.gridMinor]} />

        {d.points.map((p) => (
          <GreekPoint
            key={`${p.dte}-${p.strike}`}
            x={p.x}
            y={p.y}
            z={p.z}
            color={nodeColor(p.color)}
            size={0.05}
            onHover={setHover}
            readout={{ strike: p.strike, dte: p.dte, value: p.value }}
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
      </Canvas>

      {/* DOM overlay: axes, exact-unit Z ticks, legend, hover readout */}
      <div className="pointer-events-none absolute inset-0 font-mono text-type-2xs text-muted-foreground">
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2">Strike →</span>
        <span className="absolute right-1 top-1/2 -translate-y-1/2 rotate-90">DTE →</span>
        <div className="absolute left-1 top-2 flex flex-col gap-0.5">
          <span className="font-semibold text-foreground">{label} ({unit})</span>
          {d.zTicks.map((v) => (
            <span key={v} className="tabular-nums">{v.toFixed(4)}</span>
          ))}
        </div>
        <div className="absolute left-1 top-1/2 flex flex-col gap-0.5">
          {hover && (
            <span className="rounded bg-card/80 px-1.5 py-0.5 text-foreground" data-testid="greeks-3d-readout">
              K {hover.strike.toFixed(0)} · {hover.dte}d · {hover.value.toFixed(4)}
            </span>
          )}
        </div>
        <span className="absolute bottom-1 left-1 flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: colors.foreground }} aria-hidden />
          observed
          <span className="inline-block h-1.5 w-1.5" style={{ background: colors.brand }} aria-hidden />
          ATM ridge
          {showWire && (
            <>
              <span className="inline-block h-px w-4" style={{ background: colors.rate }} aria-hidden />
              observed wireframe (not a model fit)
            </>
          )}
        </span>
      </div>

      {/* Explicit observed-wireframe toggle — no fabricated model layer exists. */}
      <div className="absolute top-2 right-2">
        <button
          type="button"
          data-testid="greeks-3d-wireframe-toggle"
          aria-pressed={showWire}
          onClick={() => setShowWire((s) => !s)}
          className="rounded border border-border bg-card px-2 py-1 font-mono text-type-2xs text-foreground hover:bg-muted/30 focus-ring-term"
        >
          {showWire ? 'Hide' : 'Show'} observed wireframe
        </button>
      </div>
    </div>
  );
}

export default GreekSurface3D;