/**
 * Crypto Options 3D Surface — IV or Greeks
 *
 * Builds a single 3D mesh from the flat SurfacePoint[] data.
 * X-axis = actual strike prices ($), Z-axis = DTE, Y-axis = field value.
 * Wing mode (OTM / ITM / ATM / ALL) controls which side's data feeds the grid.
 * Surface field (IV / Delta / Gamma / Theta / Vega) controls what Y shows.
 */
import { useCallback, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import { ivRamp01 } from '../../../lib/options/color';
import { VISUAL_CONFIG } from '../../../config/constants';
import type { SurfaceData } from '../CryptoOptionsView';

// ── constants ──────────────────────────────────────────────────────────────

const { WIDTH, DEPTH, VISUAL_HEIGHT, UPSCALE } = VISUAL_CONFIG.surface;

export type WingMode = 'otm' | 'itm' | 'atm' | 'all';
export type SurfaceField = 'iv' | 'delta' | 'gamma' | 'theta' | 'vega';

const FIELDS: { key: SurfaceField; label: string; unit: string; decimals: number; cap?: number }[] = [
  { key: 'iv',    label: 'IV',    unit: '%', decimals: 0, cap: 2.0 },
  { key: 'delta', label: 'Δ',     unit: '',  decimals: 2, cap: 1.0 },
  { key: 'gamma', label: 'Γ',     unit: '',  decimals: 6, cap: 0.001 },
  { key: 'theta', label: 'Θ',     unit: '',  decimals: 2, cap: 500 },
  { key: 'vega',  label: 'ν',     unit: '',  decimals: 2, cap: 5.0 },
];

// ── wing + field filters ───────────────────────────────────────────────────

function filterByWing(pts: SurfaceData['points'], wing: WingMode, S: number): SurfaceData['points'] {
  if (wing === 'all') return pts;
  return pts.filter((p) => {
    if (wing === 'atm') {
      // ATM: strike within ±5% of spot
      return Math.abs(p.strike - S) / S < 0.05;
    }
    const otm = (p.side === 'call' && p.strike > S) || (p.side === 'put' && p.strike < S);
    return wing === 'otm' ? otm : !otm;
  });
}

function getFieldVal(p: { mark_iv: number; delta: number; gamma: number; theta: number; vega: number }, field: SurfaceField): number {
  switch (field) {
    case 'iv':     return p.mark_iv;
    case 'delta':  return Math.abs(p.delta);  // use absolute for mesh height
    case 'gamma':  return p.gamma;
    case 'theta':  return Math.abs(p.theta);
    case 'vega':   return p.vega;
  }
}

// ── grid builder ───────────────────────────────────────────────────────────

interface GridInfo {
  grid: number[][];
  strikeVals: number[];
  expiryDtes: number[];
  nZ: number;
  nX: number;
  minVal: number;
  maxVal: number;
}

function buildGrid(surface: SurfaceData, S: number, wing: WingMode, field: SurfaceField): GridInfo | null {
  const pts = filterByWing(surface.points, wing, S);
  if (!pts.length) return null;

  const strikeSet = new Set<number>();
  const expSet = new Set<number>();
  const dteMap = new Map<number, number>();

  for (const p of pts) {
    if (p.strike > 0) strikeSet.add(p.strike);
    expSet.add(p.expiry_ms);
    dteMap.set(p.expiry_ms, p.dte);
  }

  const strikeVals = [...strikeSet].sort((a, b) => a - b);
  const expiryMs = [...expSet].sort((a, b) => a - b);

  if (strikeVals.length < 2 || expiryMs.length < 2) return null;

  const nZ = expiryMs.length;
  const nX = strikeVals.length;

  const grid: number[][] = Array.from({ length: nZ }, () => Array(nX).fill(0));
  const cnt: number[][] = Array.from({ length: nZ }, () => Array(nX).fill(0));

  for (const p of pts) {
    const x = strikeVals.indexOf(p.strike);
    const z = expiryMs.indexOf(p.expiry_ms);
    if (x < 0 || z < 0) continue;
    const v = getFieldVal(p, field);
    if (!isFinite(v)) continue;
    grid[z]![x]! += v;
    cnt[z]![x]!++;
  }

  for (let z = 0; z < nZ; z++) {
    for (let x = 0; x < nX; x++) {
      if (cnt[z]![x]! > 0) {
        grid[z]![x]! /= cnt[z]![x]!;
      } else {
        grid[z]![x]! = interpCell(grid, cnt, z, x, nZ, nX);
      }
    }
  }

  let minVal = Infinity, maxVal = -Infinity;
  for (let z = 0; z < nZ; z++) {
    for (let x = 0; x < nX; x++) {
      const v = grid[z]![x]!;
      if (isFinite(v)) {
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      }
    }
  }
  if (!isFinite(minVal) || !isFinite(maxVal) || minVal === maxVal) return null;

  return {
    grid,
    strikeVals,
    expiryDtes: expiryMs.map((e) => dteMap.get(e) ?? 0),
    nZ,
    nX,
    minVal,
    maxVal,
  };
}

function interpCell(g: number[][], c: number[][], z: number, x: number, nZ: number, nX: number): number {
  let s = 0, w = 0;
  for (let dz = -3; dz <= 3; dz++) {
    for (let dx = -3; dx <= 3; dx++) {
      const nz = z + dz, nx = x + dx;
      if (nz < 0 || nz >= nZ || nx < 0 || nx >= nX || c[nz]![nx]! === 0) continue;
      const d = 1 / (1 + Math.sqrt(dz * dz + dx * dx));
      s += g[nz]![nx]! * d;
      w += d;
    }
  }
  return w > 0 ? s / w : 0;
}

function upsample(g: number[][], nZ: number, nX: number, f: number): number[][] {
  const nZ2 = (nZ - 1) * f + 1, nX2 = (nX - 1) * f + 1;
  const o: number[][] = Array.from({ length: nZ2 }, () => Array(nX2).fill(0));
  for (let z = 0; z < nZ2; z++) {
    const zf = z / f, z0 = Math.floor(zf), z1 = Math.min(z0 + 1, nZ - 1), tz = zf - z0;
    for (let x = 0; x < nX2; x++) {
      const xf = x / f, x0 = Math.floor(xf), x1 = Math.min(x0 + 1, nX - 1), tx = xf - x0;
      const t = g[z0]![x0]! * (1 - tx) + g[z0]![x1]! * tx;
      const b = g[z1]![x0]! * (1 - tx) + g[z1]![x1]! * tx;
      o[z]![x] = t * (1 - tz) + b * tz;
    }
  }
  return o;
}

// ── world coords — X = strike prices (log-spaced) ─────────────────────────

function fmtStrike(k: number): string {
  if (k >= 1000) return `$${(k / 1000).toFixed(k >= 10000 ? 0 : 1)}k`;
  return `$${k.toFixed(0)}`;
}

function interpXs(xs: number[], f: number): number[] {
  const n = xs.length, n2 = (n - 1) * f + 1;
  const o = Array.from<number>({ length: n2 });
  for (let i = 0; i < n2; i++) {
    const fi = i / f, i0 = Math.floor(fi), i1 = Math.min(i0 + 1, n - 1), t = fi - i0;
    o[i] = xs[i0]! * (1 - t) + xs[i1]! * t;
  }
  return o;
}

// ── geometry hook ──────────────────────────────────────────────────────────

interface GeoInfo {
  geo: THREE.BufferGeometry;
  atmPx: number;
  xs: number[];
  strikeVals: number[];
  expiryDtes: number[];
  nZ2: number;
  nX2: number;
  minVal: number;
  maxVal: number;
  xTicks: { px: number; label: string }[];
  fieldCfg: { key: SurfaceField; label: string; unit: string; decimals: number };
  displayMode: 'strike' | 'moneyness';
}

function useSurfaceGeo(
  surface: SurfaceData | null,
  S: number | undefined,
  wing: WingMode,
  field: SurfaceField,
  displayMode: 'strike' | 'moneyness',
): GeoInfo | null {
  return useMemo(() => {
    if (!surface || !S || !surface.points.length) return null;
    const fieldCfg = FIELDS.find((f) => f.key === field)!;

    const gi = buildGrid(surface, S, wing, field);
    if (!gi) return null;

    const { grid, strikeVals, expiryDtes, nZ, nX, minVal, maxVal } = gi;

    // Build X positions — log-spaced for moneyness, linear for strike
    let xs: number[];
    let xTicks: { px: number; label: string }[];
    let atmPx: number;

    if (displayMode === 'moneyness') {
      // Moneyness axis: strike / spot
      const moneynessVals = strikeVals.map((k) => k / S);
      const lo = Math.log(moneynessVals[0]!);
      const hi = Math.log(moneynessVals[moneynessVals.length - 1]!);
      const span = hi - lo || 1;
      xs = moneynessVals.map((m) => ((Math.log(m) - lo) / span - 0.5) * WIDTH);

      // ATM position
      let bestMn = moneynessVals[0]!;
      let bestDist = Infinity;
      for (const m of moneynessVals) {
        const d = Math.abs(m - 1);
        if (d < bestDist) { bestDist = d; bestMn = m; }
      }
      atmPx = ((Math.log(bestMn) - lo) / span - 0.5) * WIDTH;

      // Ticks at moneyness percentages
      const nTicks = 7;
      xTicks = [];
      for (let i = 0; i < nTicks; i++) {
        const frac = i / (nTicks - 1);
        const px = (frac - 0.5) * WIDTH;
        const logM = lo + frac * span;
        const m = Math.exp(logM);
        xTicks.push({ px, label: `${(m * 100).toFixed(0)}%` });
      }
    } else {
      // Strike axis: actual dollar amounts
      const lo = Math.log(strikeVals[0]!);
      const hi = Math.log(strikeVals[strikeVals.length - 1]!);
      const span = hi - lo || 1;
      xs = strikeVals.map((k) => ((Math.log(k) - lo) / span - 0.5) * WIDTH);

      // ATM position
      let bestStrike = strikeVals[0]!;
      let bestDist = Infinity;
      for (const k of strikeVals) {
        const d = Math.abs(k - S);
        if (d < bestDist) { bestDist = d; bestStrike = k; }
      }
      atmPx = ((Math.log(bestStrike) - lo) / span - 0.5) * WIDTH;

      // Ticks at strike prices
      const nTicks = 7;
      xTicks = [];
      for (let i = 0; i < nTicks; i++) {
        const frac = i / (nTicks - 1);
        const px = (frac - 0.5) * WIDTH;
        const logK = lo + frac * span;
        const k = Math.exp(logK);
        xTicks.push({ px, label: fmtStrike(k) });
      }
    }

    // Upsample grid
    const gridUp = upsample(grid, nZ, nX, UPSCALE);
    const nZ2 = (nZ - 1) * UPSCALE + 1;
    const nX2 = (nX - 1) * UPSCALE + 1;
    const xs2 = interpXs(xs, UPSCALE);
    const range = maxVal - minVal;

    // Build geometry
    const pos = new Float32Array(nX2 * nZ2 * 3);
    const col = new Float32Array(nX2 * nZ2 * 3);
    const idx: number[] = [];

    for (let z = 0; z < nZ2; z++) {
      for (let x = 0; x < nX2; x++) {
        const i = z * nX2 + x;
        const px = xs2[x]!;
        const py = ((gridUp[z]![x]! - minVal) / range) * VISUAL_HEIGHT;
        const pz = (z / (nZ2 - 1) - 0.5) * DEPTH;

        pos[i * 3] = px;
        pos[i * 3 + 1] = py;
        pos[i * 3 + 2] = pz;

        const t = (gridUp[z]![x]! - minVal) / range;
        const [r, g, b] = ivRamp01(t);
        col[i * 3] = r;
        col[i * 3 + 1] = g;
        col[i * 3 + 2] = b;

        if (x < nX2 - 1 && z < nZ2 - 1) {
          idx.push(i, i + 1, i + nX2, i + 1, i + nX2 + 1, i + nX2);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    return { geo, atmPx, xs, strikeVals, expiryDtes, nZ2, nX2, minVal, maxVal, xTicks, fieldCfg, displayMode };
  }, [surface, S, wing, field, displayMode]);
}

// ── three.js children ──────────────────────────────────────────────────────

function SurfaceMesh({
  geo, wireframe, onPointerMove, onClick,
}: {
  geo: THREE.BufferGeometry; wireframe: boolean;
  onPointerMove?: (e: THREE.Event) => void; onClick?: (e: THREE.Event) => void;
}) {
  return (
    <mesh geometry={geo} onPointerMove={onPointerMove} onClick={onClick}>
      <meshPhongMaterial vertexColors side={THREE.DoubleSide} transparent opacity={0.92} wireframe={wireframe} shininess={40} />
    </mesh>
  );
}

function AtmLine({ px }: { px: number }) {
  return (
    <mesh position={[px, 0, 0]}>
      <boxGeometry args={[0.018, 0.006, DEPTH]} />
      <meshBasicMaterial color="#f59e0b" transparent opacity={0.9} />
    </mesh>
  );
}

function Axes({ info, S }: { info: GeoInfo; S: number }) {
  const cls = 'text-type-2xs font-mono whitespace-nowrap';
  const { fieldCfg, minVal, maxVal } = info;

  // Y-axis ticks
  const yRange = maxVal - minVal;
  const yStep = yRange / 4;
  const yTicks: { value: number; t: number }[] = [];
  for (let i = 0; i <= 4; i++) {
    const v = minVal + i * yStep;
    yTicks.push({ value: v, t: i / 4 });
  }

  const fmtY = (v: number) => {
    if (fieldCfg.unit === '%') return `${(v * 100).toFixed(fieldCfg.decimals)}%`;
    if (Math.abs(v) < 0.001) return v.toExponential(fieldCfg.decimals);
    return v.toFixed(fieldCfg.decimals);
  };

  return (
    <>
      <gridHelper args={[4, 8, '#2a2a3d', '#1a1a2e']} position={[0, 0, 0]} />
      {/* X-axis: strike prices */}
      {info.xTicks.map((t, i) => (
        <Html key={`x${i}`} position={[t.px, 0, DEPTH / 2 + 0.05]} center distanceFactor={6}>
          <span className={cls} style={{ color: 'var(--muted-foreground)' }}>{t.label}</span>
        </Html>
      ))}
      <Html position={[WIDTH / 2 + 0.3, 0, DEPTH / 2 + 0.05]} center distanceFactor={6}>
        <span className={`${cls} uppercase tracking-wider`} style={{ color: 'var(--muted-foreground)' }}>
          {info.displayMode === 'moneyness' ? 'Moneyness' : 'Strike'}
        </span>
      </Html>
      {/* Z-axis: DTE */}
      {info.expiryDtes.map((d, i) => {
        const n = info.expiryDtes.length;
        if (n > 8 && i % Math.ceil((n - 1) / 6) !== 0 && i !== n - 1) return null;
        return (
          <Html key={`z${d}`} position={[-WIDTH / 2 - 0.15, 0, (i / (n - 1) - 0.5) * DEPTH]} center distanceFactor={6}>
            <span className={cls} style={{ color: 'var(--muted-foreground)' }}>{Math.round(d)}d</span>
          </Html>
        );
      })}
      <Html position={[-WIDTH / 2 - 0.4, 0, -DEPTH / 2 - 0.2]} center distanceFactor={6}>
        <span className={`${cls} uppercase tracking-wider`} style={{ color: 'var(--muted-foreground)' }}>DTE</span>
      </Html>
      {/* Y-axis: field value */}
      {yTicks.map((t, i) => (
        <Html key={`y${i}`} position={[-WIDTH / 2 - 0.1, t.t * VISUAL_HEIGHT, DEPTH / 2 + 0.1]} center distanceFactor={6}>
          <span className={cls} style={{ color: 'var(--cyan)' }}>{fmtY(t.value)}</span>
        </Html>
      ))}
      <Html position={[-WIDTH / 2 - 0.4, VISUAL_HEIGHT / 2, DEPTH / 2 + 0.05]} center distanceFactor={6}>
        <span className={`${cls} uppercase tracking-wider`} style={{ color: 'var(--cyan)' }}>
          {fieldCfg.label} {fmtY(info.minVal)}–{fmtY(info.maxVal)}
        </span>
      </Html>
      {/* Spot label */}
      <Html position={[-WIDTH / 2 + 0.3, VISUAL_HEIGHT + 0.15, -DEPTH / 2]} center distanceFactor={6}>
        <span className={`${cls} text-amber-400`}>
          Spot ${S.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
      </Html>
    </>
  );
}

// ── legend ─────────────────────────────────────────────────────────────────

function Legend({ lo, hi, fieldCfg }: { lo: number; hi: number; fieldCfg: { label: string; unit: string; decimals: number } }) {
  const fmt = (v: number) => {
    if (fieldCfg.unit === '%') return `${(v * 100).toFixed(0)}%`;
    if (Math.abs(v) < 0.001) return v.toExponential(1);
    return v.toFixed(fieldCfg.decimals);
  };
  const stops = [0, 0.2, 0.4, 0.6, 0.8, 1]
    .map((t) => {
      const [r, g, b] = ivRamp01(t);
      return `rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0}) ${(t * 100).toFixed(0)}%`;
    })
    .join(', ');
  return (
    <div className="absolute bottom-3 right-3 flex flex-col gap-1 font-mono text-type-xs">
      <div className="flex justify-between text-muted-foreground">
        <span>{fmt(lo)}</span>
        <span className="uppercase tracking-wider">{fieldCfg.label}</span>
        <span>{fmt(hi)}</span>
      </div>
      <div className="h-2 w-40 rounded" style={{ background: `linear-gradient(to right, ${stops})` }} />
    </div>
  );
}

// ── inspect ────────────────────────────────────────────────────────────────

interface InspectPt {
  strike: number;
  dte: number;
  value: number;
  delta: number | null;
  fieldCfg: { label: string; unit: string; decimals: number };
}

function HoverBadge({ p }: { p: InspectPt | null }) {
  if (!p) return null;
  const fmtVal = (v: number) => {
    if (p.fieldCfg.unit === '%') return `${(v * 100).toFixed(1)}%`;
    if (Math.abs(v) < 0.001) return v.toExponential(2);
    return v.toFixed(p.fieldCfg.decimals);
  };
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded border border-border bg-card/90 px-2 py-1 font-mono text-type-2xs text-muted-foreground shadow">
      <span className="text-cyan-400">{fmtVal(p.value)} {p.fieldCfg.label}</span>
      <span className="ml-2 text-foreground">${p.strike.toFixed(0)}</span>
      <span className="ml-2">{Math.round(p.dte)}d</span>
      {p.delta != null && <span className="ml-2">Δ={p.delta.toFixed(4)}</span>}
    </div>
  );
}

function InspectPanel({ p }: { p: InspectPt | null }) {
  if (!p) return null;
  const fmtVal = (v: number) => {
    if (p.fieldCfg.unit === '%') return `${(v * 100).toFixed(1)}%`;
    if (Math.abs(v) < 0.001) return v.toExponential(4);
    return v.toFixed(p.fieldCfg.decimals);
  };
  return (
    <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded border border-border bg-card/95 px-3 py-2 font-mono text-type-xs text-muted-foreground shadow-lg">
      <div className="mb-1 text-center text-type-2xs uppercase tracking-wider text-foreground">Point Inspection</div>
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <span>Strike</span>
        <span className="tabular-nums text-right text-foreground">${p.strike.toFixed(0)}</span>
        <span>DTE</span>
        <span className="tabular-nums text-right text-foreground">{Math.round(p.dte)}d</span>
        <span className="col-span-2 border-t border-border my-0.5" />
        <span className="text-cyan-400">{p.fieldCfg.label}</span>
        <span className="tabular-nums text-right text-cyan-400">{fmtVal(p.value)}</span>
        {p.delta != null && (
          <>
            <span>Δ</span>
            <span className="tabular-nums text-right text-foreground">{p.delta.toFixed(4)}</span>
          </>
        )}
      </div>
    </div>
  );
}

// ── main component ─────────────────────────────────────────────────────────

interface Props {
  surface: SurfaceData | null;
  underlyingPrice: number | undefined;
  loading?: boolean;
  wing?: WingMode;
  field?: SurfaceField;
  displayMode?: 'strike' | 'moneyness';
}

export function CryptoSurface3D({
  surface,
  underlyingPrice: S,
  loading,
  wing = 'all',
  field = 'iv',
  displayMode = 'strike',
}: Props) {
  const [wireframe, setWireframe] = useState(false);
  const [hover, setHover] = useState<InspectPt | null>(null);
  const [sel, setSel] = useState<InspectPt | null>(null);

  const info = useSurfaceGeo(surface, S, wing, field, displayMode);

  const buildPt = useCallback(
    (px: number, pz: number): InspectPt | null => {
      if (!info || !surface || !S) return null;
      // Find closest DTE
      const zi = Math.round(((pz / DEPTH + 0.5) * (info.nZ2 - 1)));
      const ei = Math.round(zi / UPSCALE);
      if (ei < 0 || ei >= info.expiryDtes.length) return null;
      // Find closest strike by X position
      let bx = 0, bd = Infinity;
      for (let i = 0; i < info.xs.length; i++) {
        const d = Math.abs(info.xs[i]! - px);
        if (d < bd) { bd = d; bx = i; }
      }
      const strike = info.strikeVals[bx]!;
      const dte = info.expiryDtes[ei]!;
      // Read value from geometry Y position
      const z2 = Math.round(ei * UPSCALE);
      const x2 = Math.round(bx * UPSCALE);
      let value = 0;
      if (z2 < info.nZ2 && x2 < info.nX2) {
        const posArr = info.geo.getAttribute('position') as THREE.BufferAttribute;
        const py = (posArr.array as Float32Array)[(z2 * info.nX2 + x2) * 3 + 1]!;
        const range = info.maxVal - info.minVal || 1;
        value = info.minVal + (py / VISUAL_HEIGHT) * range;
      }
      // Find closest point for delta
      let closest: (typeof surface.points)[number] | null = null;
      let closestDist = Infinity;
      for (const p of surface.points) {
        const d = Math.abs(p.strike - strike) + Math.abs(p.dte - dte) * 0.1;
        if (d < closestDist) { closestDist = d; closest = p; }
      }
      return {
        strike,
        dte,
        value,
        delta: closest && closestDist < 1000 ? closest.delta : null,
        fieldCfg: info.fieldCfg,
      };
    },
    [info, surface, S],
  );

  const handlePointerMove = useCallback(
    (e: THREE.Event) => {
      const evt = e as unknown as { point: THREE.Vector3; stopPropagation: () => void };
      evt.stopPropagation();
      setHover(buildPt(evt.point.x, evt.point.z));
    },
    [buildPt],
  );

  const handleClick = useCallback(
    (e: THREE.Event) => {
      const evt = e as unknown as { point: THREE.Vector3; stopPropagation: () => void };
      evt.stopPropagation();
      setSel(buildPt(evt.point.x, evt.point.z));
    },
    [buildPt],
  );

  if (loading) {
    return <div className="flex h-full items-center justify-center font-mono text-type-xs text-muted-foreground">Loading surface…</div>;
  }
  if (!surface || !S) {
    return <div className="flex h-full items-center justify-center font-mono text-type-xs text-muted-foreground">No surface data</div>;
  }

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
            <SurfaceMesh geo={info.geo} wireframe={wireframe} onPointerMove={handlePointerMove} onClick={handleClick} />
            <AtmLine px={info.atmPx} />
            <Axes info={info} S={S} />
          </>
        )}
      </Canvas>

      {info && <Legend lo={info.minVal} hi={info.maxVal} fieldCfg={info.fieldCfg} />}
      <HoverBadge p={hover} />
      <InspectPanel p={sel} />

      {/* Wireframe toggle */}
      <button
        type="button"
        onClick={() => setWireframe((f) => !f)}
        className="absolute top-3 right-3 z-10 rounded border border-border bg-card/80 px-2 py-1 font-mono text-type-2xs text-muted-foreground hover:bg-muted"
      >
        {wireframe ? 'Solid' : 'Wire'}
      </button>

      {!sel && (
        <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 font-mono text-type-2xs text-muted-foreground/50">
          Click a point to inspect
        </div>
      )}
    </div>
  );
}
