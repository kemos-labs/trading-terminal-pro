import { useState, useMemo, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import { useTerminalStore } from '../../../store/terminalStore';
import { ivRamp01 } from '../../../lib/options/color';
import { VISUAL_CONFIG } from '../../../config/constants';
import { CANVAS } from '../../../lib/chartTheme';
import { buildStrikeWorldXs, type XTick } from '../surfaceStrikeMapping';
import { SurfaceTools, type SliceMode } from './SurfaceTools';
import { SurfaceInspect, type InspectPoint } from './SurfaceInspect';
import { Explain } from '../../common/Explain';
import { pickSurfaceQuote, type SurfaceWingMode } from '../../../lib/options/synthetic';

const { MONEYNESS_MIN, MONEYNESS_MAX, WIDTH, DEPTH, VISUAL_HEIGHT, UPSCALE } = VISUAL_CONFIG.surface;

export interface IVTick { value: number; t: number }

const NICE_NUMS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]

function niceNum(range: number, roundUp: boolean): number {
  const exp = Math.floor(Math.log10(range))
  const frac = range / Math.pow(10, exp)
  let nice: number
  if (roundUp) {
    nice = NICE_NUMS.find(n => n >= frac) ?? 10
  } else {
    nice = [...NICE_NUMS].reverse().find(n => n <= frac) ?? 1
  }
  return nice * Math.pow(10, exp)
}

export function computeIVTicks(minIV: number, maxIV: number): IVTick[] {
  const range = maxIV - minIV
  if (range === 0) return [{ value: minIV, t: 0.5 }]

  const step = niceNum(range / 4, true)
  if (step === 0) return [{ value: minIV, t: 0.5 }]

  const niceMin = Math.floor(minIV / step) * step
  const niceMax = Math.ceil(maxIV / step) * step
  const dataRange = maxIV - minIV || 1

  const ticks: IVTick[] = []
  for (let v = niceMin; v <= niceMax + step * 0.001; v += step) {
    const rounded = Math.round(v / step) * step
    const t = (rounded - minIV) / dataRange
    ticks.push({ value: rounded, t })
  }
  return ticks
}

function upsampleGrid(
  iv: number[][],
  nZ: number,
  nX: number,
  factor: number,
): { values: number[][]; nZ2: number; nX2: number } {
  const nZ2 = (nZ - 1) * factor + 1;
  const nX2 = (nX - 1) * factor + 1;
  const values: number[][] = Array.from({ length: nZ2 }, () => Array(nX2).fill(0));

  for (let z2 = 0; z2 < nZ2; z2++) {
    const zf = z2 / factor;
    const z0 = Math.floor(zf);
    const z1 = Math.min(z0 + 1, nZ - 1);
    const tz = zf - z0;

    for (let x2 = 0; x2 < nX2; x2++) {
      const xf = x2 / factor;
      const x0 = Math.floor(xf);
      const x1 = Math.min(x0 + 1, nX - 1);
      const tx = xf - x0;

      const v00 = iv[z0]![x0]!;
      const v10 = iv[z0]![x1]!;
      const v01 = iv[z1]![x0]!;
      const v11 = iv[z1]![x1]!;

      const top = v00 * (1 - tx) + v10 * tx;
      const bot = v01 * (1 - tx) + v11 * tx;
      values[z2]![x2] = top * (1 - tz) + bot * tz;
    }
  }

  return { values, nZ2, nX2 };
}

interface GeometryInfo {
  geo: THREE.BufferGeometry;
  nZ: number;
  minIV: number;
  maxIV: number;
  atmPx: number;
  dtes: number[];
  spot: number;
  start: number;
  end: number;
  nX: number;
  nX2: number;
  nZ2: number;
  xTicks: XTick[];
  xAxisLabel: string;
  mapPointToCell: (px: number, pz: number) => { expiryIdx: number; strikeIdx: number } | null;
}

function interpolateXs(strikeXs: number[], factor: number): number[] {
  const nX = strikeXs.length;
  const nX2 = (nX - 1) * factor + 1;
  const out = Array.from<number>({ length: nX2 });
  for (let x2 = 0; x2 < nX2; x2++) {
    const xf = x2 / factor;
    const x0 = Math.floor(xf);
    const x1 = Math.min(x0 + 1, nX - 1);
    const tx = xf - x0;
    out[x2] = strikeXs[x0]! * (1 - tx) + strikeXs[x1]! * tx;
  }
  return out;
}

function useSurfaceGeometry(): GeometryInfo | null {
  const surface = useTerminalStore(s => s.surface);
  const snapshot = useTerminalStore(s => s.snapshot);
  const spot = useTerminalStore(s => s.snapshot?.spot ?? 100);
  const displayMode = useTerminalStore(s => s.displayMode);

  return useMemo(() => {
    if (!surface || !snapshot || surface.strikes.length < 2 || surface.expiries.length < 2) {
      return null;
    }

    const start = surface.strikes.findIndex(s => s / spot >= MONEYNESS_MIN);
    const end = surface.strikes.findLastIndex(s => s / spot <= MONEYNESS_MAX);
    if (start < 0 || end <= start) return null;

    const nX = end - start + 1;
    const nZ = surface.expiries.length;

    const { xs: strikeXs, ticks: xTicks, axisLabel: xAxisLabel } = buildStrikeWorldXs(
      displayMode,
      surface,
      snapshot,
      start,
      end,
      spot,
    );
    const xs2 = interpolateXs(strikeXs, UPSCALE);
    const nX2 = xs2.length;

    const rawIV: number[][] = [];
    for (let z = 0; z < nZ; z++) {
      const row: number[] = [];
      for (let x = 0; x < nX; x++) {
        const v = surface.iv[z]?.[start + x];
        row.push(v != null && isFinite(v) ? v : 0);
      }
      rawIV.push(row);
    }

    const { values: ivGrid, nZ2 } = upsampleGrid(rawIV, nZ, nX, UPSCALE);

    let minIV = Infinity, maxIV = -Infinity;
    for (let z = 0; z < nZ2; z++) {
      for (let x = 0; x < nX2; x++) {
        const v = ivGrid[z]![x]!;
        if (v < minIV) minIV = v;
        if (v > maxIV) maxIV = v;
      }
    }
    const range = maxIV - minIV || 1;

    const positions = new Float32Array(nX2 * nZ2 * 3);
    const colors = new Float32Array(nX2 * nZ2 * 3);
    const indices: number[] = [];

    for (let z = 0; z < nZ2; z++) {
      for (let x = 0; x < nX2; x++) {
        const idx = z * nX2 + x;

        const px = xs2[x]!;
        const pz = (z / (nZ2 - 1) - 0.5) * DEPTH;
        const cv = ivGrid[z]![x]!;
        const py = (cv - minIV) / range * VISUAL_HEIGHT;

        positions[idx * 3] = px;
        positions[idx * 3 + 1] = py;
        positions[idx * 3 + 2] = pz;

        const t = (cv - minIV) / range;
        const [r, g, b] = ivRamp01(t);
        colors[idx * 3] = r;
        colors[idx * 3 + 1] = g;
        colors[idx * 3 + 2] = b;

        if (x < nX2 - 1 && z < nZ2 - 1) {
          const a = idx, bi = idx + 1, c = idx + nX2, d = idx + nX2 + 1;
          indices.push(a, bi, c, bi, d, c);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    // ATM strike's mapped X coord (using the closest strike to spot).
    let atmStrikeIdx = start;
    let best = Infinity;
    for (let i = start; i <= end; i++) {
      const d = Math.abs(surface.strikes[i]! - spot);
      if (d < best) { best = d; atmStrikeIdx = i; }
    }
    const atmPx = strikeXs[atmStrikeIdx - start]!;

    const mapPointToCell = (px: number, pz: number): { expiryIdx: number; strikeIdx: number } | null => {
      // Invert X by finding closest per-strike world coordinate.
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < strikeXs.length; i++) {
        const d = Math.abs(strikeXs[i]! - px);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      const z2 = Math.round(((pz / DEPTH) + 0.5) * (nZ2 - 1));
      if (z2 < 0 || z2 >= nZ2) return null;
      const expiryIdx = Math.round(z2 / UPSCALE);
      const strikeIdx = start + bestIdx;
      if (expiryIdx < 0 || expiryIdx >= nZ || strikeIdx < 0 || strikeIdx >= surface.strikes.length) return null;
      return { expiryIdx, strikeIdx };
    };

    return {
      geo,
      nZ: nZ2,
      minIV,
      maxIV,
      atmPx,
      dtes: snapshot.expiries.map(e => e.dte),
      spot,
      start,
      end,
      nX,
      nX2,
      nZ2,
      xTicks,
      xAxisLabel,
      mapPointToCell,
    };
  }, [surface, snapshot, spot, displayMode]);
}

function SurfaceMesh({
  geo,
  wireframe,
  onPointerMove,
  onClick,
}: {
  geo: THREE.BufferGeometry;
  wireframe: boolean;
  onPointerMove?: (e: THREE.Event) => void;
  onClick?: (e: THREE.Event) => void;
}) {
  return (
    <mesh geometry={geo} onPointerMove={onPointerMove} onClick={onClick}>
      <meshPhongMaterial vertexColors side={THREE.DoubleSide} transparent opacity={0.92} wireframe={wireframe} shininess={40} />
    </mesh>
  );
}

function SurfaceAtmLine({ atmPx }: { atmPx: number }) {
  return (
    <mesh position={[atmPx, 0, 0]}>
      <boxGeometry args={[0.018, 0.006, DEPTH]} />
      <meshBasicMaterial color={CANVAS.brand} transparent opacity={0.9} />
    </mesh>
  );
}

function SurfaceAxes({ info }: { info: GeometryInfo }) {
  const labelCls = 'text-type-2xs font-mono whitespace-nowrap';

  const yTicks = useMemo(() => computeIVTicks(info.minIV, info.maxIV), [info.minIV, info.maxIV]);

  return (
    <>
      <gridHelper args={[4, 8, CANVAS.grid, CANVAS.gridMinor]} position={[0, 0, 0]} />

      {info.xTicks.map((tick, i) => (
        <Html key={`x${i}-${tick.label}`} position={[tick.px, 0, DEPTH / 2 + 0.05]} center distanceFactor={6}>
          <span className={labelCls} style={{ color: 'var(--muted-foreground)' }} data-testid={`x-tick-${i}`}>{tick.label}</span>
        </Html>
      ))}
      <Html position={[0, 0, DEPTH / 2 + 0.35]} center distanceFactor={6}>
        <span
          className={`${labelCls} uppercase tracking-wider`}
          style={{ color: 'var(--muted-foreground)' }}
          data-testid="x-axis-label"
        >
          {info.xAxisLabel}
        </span>
      </Html>

      {info.dtes.map((dte, i) => {
        const len = info.dtes.length;
        if (len > 8 && i % Math.ceil((len - 1) / 6) !== 0 && i !== len - 1) return null;
        return (
          <Html
            key={`z${dte}`}
            position={[-WIDTH / 2 - 0.15, 0, (i / (len - 1) - 0.5) * DEPTH]}
            center
            distanceFactor={6}
          >
            <span className={labelCls} style={{ color: 'var(--muted-foreground)' }}>{dte}d</span>
          </Html>
        );
      })}
      <Html position={[-WIDTH / 2 - 0.4, 0, -DEPTH / 2 - 0.2]} center distanceFactor={6}>
        <span className={`${labelCls} uppercase tracking-wider`} style={{ color: 'var(--muted-foreground)' }}>
          DTE
        </span>
      </Html>

      {yTicks.map((tick, i) => (
        <Html key={`y${i}`} position={[-WIDTH / 2 - 0.1, tick.t * VISUAL_HEIGHT, DEPTH / 2 + 0.1]} center distanceFactor={6}>
          <span className={labelCls} style={{ color: 'var(--cyan)' }} data-testid={`y-tick-${i}`}>{(tick.value * 100).toFixed(0)}%</span>
        </Html>
      ))}
      <Html position={[-WIDTH / 2 - 0.4, VISUAL_HEIGHT / 2, DEPTH / 2 + 0.05]} center distanceFactor={6}>
        <span
          className={`${labelCls} uppercase tracking-wider`}
          style={{ color: 'var(--cyan)' }}
          data-testid="y-axis-label"
        >
          IV {(info.minIV * 100).toFixed(1)}–{(info.maxIV * 100).toFixed(1)}%
        </span>
      </Html>
    </>
  );
}

function SurfaceLegend({ minIV, maxIV }: { minIV: number; maxIV: number }) {
  const stops = [0, 0.2, 0.4, 0.6, 0.8, 1].map(t => {
    const [r, g, b] = ivRamp01(t);
    return `rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0}) ${(t * 100).toFixed(0)}%`;
  }).join(', ');

  return (
    <div className="absolute bottom-3 right-3 flex flex-col gap-1 text-type-xs font-mono">
        <div className="flex justify-between text-muted-foreground">
          <span>{(minIV * 100).toFixed(1)}%</span>
          <span className="uppercase tracking-wider"><Explain term="iv">IV</Explain></span>
          <span>{(maxIV * 100).toFixed(1)}%</span>
        </div>
      <div className="w-40 h-2 rounded" style={{ background: `linear-gradient(to right, ${stops})` }} />
    </div>
  );
}

const WING_MODE_HINT: Record<SurfaceWingMode, string> = {
  otm: 'OTM wings (desk default) — cleaner smile; deep OTM still noisy on free chains.',
  itm: 'ITM side — mid near intrinsic → IV solver can spike; not a crash signal by itself.',
  all: 'ALL — averages call+put when both exist; blends API coverage, not a new model.',
};

/** Desk note in empty lower-left canvas (away from mesh / tools). */
function SurfaceExplainPanel({
  wingMode,
  minIV,
  maxIV,
  hasMesh,
}: {
  wingMode: SurfaceWingMode;
  minIV: number | null;
  maxIV: number | null;
  hasMesh: boolean;
}) {
  const scaleNote =
    minIV != null && maxIV != null
      ? `Color scale is mesh min–max (${(minIV * 100).toFixed(0)}–${(maxIV * 100).toFixed(0)}%), not ATM.`
      : 'Color scale is mesh min–max, not ATM / VIX.';

  return (
    <div
      className="pointer-events-none absolute bottom-20 right-3 z-[1] max-w-[min(22rem,45%)] rounded border border-border bg-card/90 p-2.5 text-type-2xs font-mono text-muted-foreground leading-relaxed shadow-sm"
      data-testid="surface-explain"
    >
      <div className="mb-1 text-foreground uppercase tracking-wider">What this surface indicates</div>
      {!hasMesh ? (
        <p>
          No live chain mesh yet. Fail-closed: empty surface means missing quotes, not a synthetic smile.
          Load a symbol with an option chain (e.g. SPY) under LIVE.
        </p>
      ) : (
        <ul className="list-none space-y-1.5">
          <li>
            <span className="text-foreground">Height / color</span> = implied vol by strike × expiry
            (SVI-smoothed grid). Spikes on far wings often mean <span className="text-foreground">thin mids</span>
            , not “spot will crash X%.”
          </li>
          <li>
            <span className="text-foreground">ATM / VIX strip</span> is the level story. The 3D max on the
            legend is usually a <span className="text-foreground">wing cell</span>, not front ATM.
          </li>
          <li>
            <span className="text-foreground">Chain side · {wingMode.toUpperCase()}</span> — {WING_MODE_HINT[wingMode]}
          </li>
          <li>{scaleNote} Prefer fixed-K ATM and 25Δ RR/fly over max color for shape changes.</li>
        </ul>
      )}
    </div>
  );
}

export function SurfaceView() {
  const [wireframe, setWireframe] = useState(false);
  const [sliceMode, setSliceMode] = useState<SliceMode>('none');
  const [hover, setHover] = useState<InspectPoint | null>(null);
  const [selected, setSelected] = useState<InspectPoint | null>(null);


  const info = useSurfaceGeometry();
  const spot = useTerminalStore(s => s.snapshot?.spot ?? 0);
  const surface = useTerminalStore(s => s.surface);
  const snapshot = useTerminalStore(s => s.snapshot);
  const sviReadout = useTerminalStore(s => s.sviReadout);
  const arbResult = useTerminalStore(s => s.arbResult);
  const selectedExpiry = useTerminalStore(s => s.selectedExpiry);
  const surfaceWingMode = useTerminalStore(s => s.surfaceWingMode);

  const buildPoint = useCallback((px: number, pz: number): InspectPoint | null => {
    if (!info || !surface || !snapshot) return null;
    const cell = info.mapPointToCell(px, pz);
    if (!cell) return null;
    const expiry = surface.expiries[cell.expiryIdx];
    const strike = surface.strikes[cell.strikeIdx];
    const iv = surface.iv[cell.expiryIdx]?.[cell.strikeIdx];
    if (!expiry || strike == null || iv == null || !isFinite(iv)) return null;
    const slice = snapshot.expiries[cell.expiryIdx];
    const dte = slice?.dte ?? 0;
    const quote = slice
      ? pickSurfaceQuote(slice, strike, snapshot.spot, surfaceWingMode)
      : null;
    return { strike, expiry, dte, iv, delta: quote?.delta ?? null };
  }, [info, surface, snapshot, surfaceWingMode]);

  const handlePointerMove = useCallback((e: THREE.Event) => {
    const evt = e as unknown as { point: THREE.Vector3; stopPropagation: () => void };
    evt.stopPropagation();
    setHover(buildPoint(evt.point.x, evt.point.z));
  }, [buildPoint]);

  const handleClick = useCallback((e: THREE.Event) => {
    const evt = e as unknown as { point: THREE.Vector3; stopPropagation: () => void };
    evt.stopPropagation();
    const p = buildPoint(evt.point.x, evt.point.z);
    if (p) {
      setSelected(p);
      useTerminalStore.getState().setSelectedExpiry(p.expiry);
    }
  }, [buildPoint]);

  return (
    <div className="relative h-full w-full">
      <Canvas
        camera={{ position: [3.4, 2.8, 3.8], fov: 42 }}
        gl={{ antialias: true, alpha: false }}
        style={{ background: 'var(--background)' }}
      >
        <ambientLight intensity={0.45} />
        <directionalLight position={[5, 10, 5]} intensity={0.8} />
        <OrbitControls
          enablePan={false}
          target={[0, 0.5, 0]}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={Math.PI / 2.2}
          minDistance={2}
          maxDistance={9}
        />
        {info && (
          <>
            <SurfaceMesh
              geo={info.geo}
              wireframe={wireframe}
              onPointerMove={handlePointerMove}
              onClick={handleClick}
            />
            <SurfaceAtmLine atmPx={info.atmPx} />
            <SurfaceAxes info={info} />
          </>
        )}
      </Canvas>

      {info && <SurfaceLegend minIV={info.minIV} maxIV={info.maxIV} />}

      <div className="absolute top-3 left-3 flex flex-col gap-2">
        <button
          onClick={() => setWireframe(w => !w)}
          className="px-2 py-1 text-type-xs font-mono bg-card border border-border rounded hover:bg-muted text-muted-foreground"
        >
          {wireframe ? 'Solid' : 'Wireframe'}
        </button>
        {info && (
          <div className="px-2 py-1 text-type-2xs font-mono bg-card/80 border border-border rounded text-muted-foreground">
            <div><Explain term="spot">Spot</Explain> <span className="text-foreground tabular-nums">{spot.toFixed(2)}</span></div>
            <div><Explain term="iv">IV</Explain> <span className="text-cyan tabular-nums">{(info.minIV * 100).toFixed(1)}–{(info.maxIV * 100).toFixed(1)}%</span></div>
            <div>
              Side{' '}
              <span className="text-foreground uppercase tabular-nums" data-testid="wing-mode-badge">
                {surfaceWingMode}
              </span>
            </div>
          </div>
        )}
      </div>

      <SurfaceExplainPanel
        wingMode={surfaceWingMode}
        minIV={info?.minIV ?? null}
        maxIV={info?.maxIV ?? null}
        hasMesh={!!info}
      />

      <SurfaceTools
        surface={surface}
        sviReadout={sviReadout}
        arbResult={arbResult}
        sliceMode={sliceMode}
        onSliceMode={setSliceMode}
        selectedExpiry={selectedExpiry}
        selectedStrike={selected?.strike ?? null}
      />

      <SurfaceInspect hover={hover} selected={selected} />
    </div>
  );
}
