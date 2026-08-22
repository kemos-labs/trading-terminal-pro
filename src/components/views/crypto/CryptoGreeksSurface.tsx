/**
 * Crypto Greeks 3D Surface — Delta / Gamma / Theta / Vega
 *
 * Separate 3D surfaces for each Greek, with its own sub-navigation.
 * Mirrors the Vol desk pattern where Greeks have dedicated views.
 */
import { useCallback, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { SurfaceData } from '../CryptoOptionsView';

export type GreekField = 'delta' | 'gamma' | 'theta' | 'vega';

const GREEKS: { key: GreekField; label: string; units: string; decimals: number }[] = [
  { key: 'delta', label: 'Delta',      units: '', decimals: 4 },
  { key: 'gamma', label: 'Gamma',      units: '', decimals: 6 },
  { key: 'theta', label: 'Theta / dt', units: '', decimals: 4 },
  { key: 'vega',  label: 'Vega',       units: '', decimals: 4 },
];

function fieldVal(p: { delta: number; gamma: number; theta: number; vega: number }, f: GreekField): number {
  if (f === 'delta') return p.delta;
  if (f === 'gamma') return p.gamma;
  if (f === 'theta') return p.theta;
  return p.vega;
}

// ── Color ramps ────────────────────────────────────────────────────────────

function signedRamp(t: number): [number, number, number] {
  if (t < 0.5) { const u = t / 0.5; return [0.9*(1-u)+u, 0.2*(1-u)+u, 0.2*(1-u)+u]; }
  const u = (t - 0.5) / 0.5; return [(1-u)+0.2*u, (1-u)+0.8*u, (1-u)+0.2*u];
}
function monoRamp(t: number): [number, number, number] {
  const u = Math.max(0, Math.min(1, t));
  if (u < 0.5) { const v = u / 0.5; return [0.15*(1-v)+0.3*v, 0.3*(1-v)+0.6*v, 0.6*(1-v)+v]; }
  const v = (u - 0.5) / 0.5; return [0.3*(1-v)+0.95*v, 0.6*(1-v)+0.7*v, (1-v)+0.1*v];
}
function rampFor(f: GreekField, t: number): [number, number, number] {
  return f === 'delta' ? signedRamp(t) : monoRamp(t);
}

// ── ticks ──────────────────────────────────────────────────────────────────

interface Tick { value: number; t: number }
function niceTicks(min: number, max: number, n: number): Tick[] {
  if (max === min) return [{ value: min, t: 0.5 }];
  const step = Math.pow(10, Math.floor(Math.log10((max - min) / n)));
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, r = max - min || 1;
  const t: Tick[] = [];
  for (let v = lo; v <= hi + step * 0.001; v += step) t.push({ value: v, t: (v - min) / r });
  return t;
}

// ── grid ───────────────────────────────────────────────────────────────────

interface GridInfo { grid: number[][]; mn: number[]; dtes: number[]; nZ: number; nX: number; min: number; max: number }

function buildGrid(pts: SurfaceData['points'], S: number, field: GreekField): GridInfo | null {
  if (!pts.length) return null;
  const mnSet = new Set<number>(), exSet = new Set<number>(), dm = new Map<number, number>();
  for (const p of pts) {
    const mn = S > 0 ? p.strike / S : p.moneyness;
    if (mn > 0) mnSet.add(mn); exSet.add(p.expiry_ms); dm.set(p.expiry_ms, p.dte);
  }
  let mnV = [...mnSet].sort((a, b) => a - b);
  const ex = [...exSet].sort((a, b) => a - b);
  mnV = mnV.filter(m => m >= 0.5 && m <= 2.5);
  if (mnV.length < 2 || ex.length < 2) return null;
  const nZ = ex.length, nX = mnV.length;
  const g: number[][] = Array.from({ length: nZ }, () => Array(nX).fill(0));
  const c: number[][] = Array.from({ length: nZ }, () => Array(nX).fill(0));
  for (const p of pts) {
    const mn = S > 0 ? p.strike / S : p.moneyness;
    const x = mnV.indexOf(mn), z = ex.indexOf(p.expiry_ms);
    if (x < 0 || z < 0) continue;
    const v = fieldVal(p, field);
    if (isFinite(v)) { g[z]![x]! += v; c[z]![x]!++; }
  }
  for (let z = 0; z < nZ; z++) for (let x = 0; x < nX; x++)
    g[z]![x] = c[z]![x]! > 0 ? g[z]![x]! / c[z]![x]! : interp(g, c, z, x, nZ, nX);
  let mn = Infinity, mx = -Infinity;
  for (let z = 0; z < nZ; z++) for (let x = 0; x < nX; x++) { const v = g[z]![x]!; if (v < mn) mn = v; if (v > mx) mx = v; }
  if (!isFinite(mn) || !isFinite(mx)) return null;
  if (field === 'delta') { const a = Math.max(Math.abs(mn), Math.abs(mx)); mn = -a; mx = a; }
  return { grid: g, mn: mnV, dtes: ex.map(e => dm.get(e) ?? 0), nZ, nX, min: mn, max: mx };
}

function interp(g: number[][], c: number[][], z: number, x: number, nZ: number, nX: number): number {
  let s = 0, w = 0;
  for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
    const nz = z + dz, nx = x + dx;
    if (nz < 0 || nz >= nZ || nx < 0 || nx >= nX || c[nz]![nx]! === 0) continue;
    const d = 1 / (1 + Math.sqrt(dz * dz + dx * dx)); s += g[nz]![nx]! * d; w += d;
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

function buildXs(mn: number[]): { xs: number[]; ticks: { px: number; label: string }[]; atmPx: number } {
  const log = (v: number) => Math.log(v);
  const lo = log(mn[0]!), hi = log(mn[mn.length - 1]!), span = hi - lo || 1;
  const xs = mn.map(m => ((log(m) - lo) / span - 0.5) * 3.6);
  const tickMns = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.5, 2.0].filter(t => t >= mn[0]! && t <= mn[mn.length - 1]!);
  const ticks = tickMns.map(m => ({ px: ((log(m) - lo) / span - 0.5) * 3.6, label: `${(m * 100).toFixed(0)}%` }));
  return { xs, ticks, atmPx: ((log(1) - lo) / span - 0.5) * 3.6 };
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

// ── geometry ───────────────────────────────────────────────────────────────

interface Geo { geo: THREE.BufferGeometry; atmPx: number; xs: number[]; mnV: number[]; dtes: number[]; nZ2: number; nX2: number; min: number; max: number; xTicks: { px: number; label: string }[] }

function useGreekGeo(surface: SurfaceData | null, S: number | undefined, field: GreekField): Geo | null {
  return useMemo(() => {
    if (!surface || !S || !surface.points.length) return null;
    const gi = buildGrid(surface.points, S, field);
    if (!gi) return null;
    const { grid, mn, dtes, nZ, nX, min, max } = gi;
    const { xs, ticks, atmPx } = buildXs(mn);
    const gridUp = upsample(grid, nZ, nX, 4);
    const nZ2 = (nZ - 1) * 4 + 1, nX2 = (nX - 1) * 4 + 1;
    const xs2 = interpXs(xs, 4);
    const range = max - min || 1;
    const pos = new Float32Array(nX2 * nZ2 * 3), col = new Float32Array(nX2 * nZ2 * 3), idx: number[] = [];
    for (let z = 0; z < nZ2; z++) for (let x = 0; x < nX2; x++) {
      const i = z * nX2 + x;
      pos[i * 3] = xs2[x]!;
      pos[i * 3 + 1] = ((gridUp[z]![x]! - min) / range) * 1.7;
      pos[i * 3 + 2] = (z / (nZ2 - 1) - 0.5) * 3.2;
      const t = (gridUp[z]![x]! - min) / range;
      const [r, g, b] = rampFor(field, t);
      col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
      if (x < nX2 - 1 && z < nZ2 - 1) { const a = i, b2 = i + 1, c = i + nX2, d = i + nX2 + 1; idx.push(a, b2, c, b2, d, c); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    return { geo, atmPx, xs, mnV: mn, dtes, nZ2, nX2, min, max, xTicks: ticks };
  }, [surface, S, field]);
}

// ── 3D components ──────────────────────────────────────────────────────────

function Mesh3D({ geo, wireframe, onMove }: { geo: THREE.BufferGeometry; wireframe: boolean; onMove?: (e: THREE.Event) => void }) {
  return (
    <mesh geometry={geo} onPointerMove={onMove}>
      <meshPhongMaterial vertexColors side={THREE.DoubleSide} transparent opacity={0.92} wireframe={wireframe} shininess={40} />
    </mesh>
  );
}

function AtmLine({ px }: { px: number }) {
  return (
    <mesh position={[px, 0.85, 0]}>
      <boxGeometry args={[0.02, 1.7, 3.2]} />
      <meshBasicMaterial color="#f59e0b" transparent opacity={0.2} />
    </mesh>
  );
}

function Axes3D({ info, field: _field, cfg }: { info: Geo; field: GreekField; cfg: typeof GREEKS[number] }) {
  const cls = 'text-type-2xs font-mono whitespace-nowrap';
  const yTicks = niceTicks(info.min, info.max, 4);
  return (
    <>
      <gridHelper args={[4, 8, '#2a2a3d', '#1a1a2e']} position={[0, 0, 0]} />
      {info.xTicks.map((t, i) => (
        <Html key={`x${i}`} position={[t.px, 0, 3.2 / 2 + 0.05]} center distanceFactor={6}>
          <span className={cls} style={{ color: 'var(--muted-foreground)' }}>{t.label}</span>
        </Html>
      ))}
      <Html position={[3.6 / 2 + 0.3, 0, 3.2 / 2 + 0.05]} center distanceFactor={6}>
        <span className={`${cls} uppercase tracking-wider`} style={{ color: 'var(--muted-foreground)' }}>Strike/Spot</span>
      </Html>
      {info.dtes.map((d, i) => {
        const n = info.dtes.length;
        if (n > 8 && i % Math.ceil((n - 1) / 6) !== 0 && i !== n - 1) return null;
        return (
          <Html key={`z${d}`} position={[-3.6 / 2 - 0.15, 0, (i / (n - 1) - 0.5) * 3.2]} center distanceFactor={6}>
            <span className={cls} style={{ color: 'var(--muted-foreground)' }}>{Math.round(d)}d</span>
          </Html>
        );
      })}
      <Html position={[-3.6 / 2 - 0.4, 0, -3.2 / 2 - 0.2]} center distanceFactor={6}>
        <span className={`${cls} uppercase tracking-wider`} style={{ color: 'var(--muted-foreground)' }}>DTE</span>
      </Html>
      {yTicks.map((t, i) => (
        <Html key={`y${i}`} position={[-3.6 / 2 - 0.1, t.t * 1.7, 3.2 / 2 + 0.1]} center distanceFactor={6}>
          <span className={cls} style={{ color: 'var(--cyan)' }}>{t.value.toFixed(cfg.decimals)}</span>
        </Html>
      ))}
      <Html position={[-3.6 / 2 - 0.4, 0.85, 3.2 / 2 + 0.05]} center distanceFactor={6}>
        <span className={`${cls} uppercase tracking-wider`} style={{ color: 'var(--cyan)' }}>{cfg.label}</span>
      </Html>
    </>
  );
}

function Legend3D({ lo, hi, field, cfg }: { lo: number; hi: number; field: GreekField; cfg: typeof GREEKS[number] }) {
  const n = 6;
  const stops = Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const [r, g, b] = rampFor(field, t);
    const v = lo + t * (hi - lo);
    return { css: `rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0})`, label: v.toFixed(cfg.decimals), pct: (t * 100).toFixed(0) };
  });
  return (
    <div className="absolute bottom-3 right-3 flex flex-col gap-1 font-mono text-type-xs">
      <div className="flex justify-between text-muted-foreground">
        <span>{stops[0]!.label}</span><span className="uppercase tracking-wider">{cfg.label}</span><span>{stops[n - 1]!.label}</span>
      </div>
      <div className="h-2 w-40 rounded" style={{ background: `linear-gradient(to right, ${stops.map(s => s.css + ' ' + s.pct + '%').join(', ')})` }} />
    </div>
  );
}

function HoverBadge({ p, field: _field, cfg }: { p: InspectPt | null; field: GreekField; cfg: typeof GREEKS[number] }) {
  if (!p) return null;
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded border border-border bg-card/90 px-2 py-1 font-mono text-type-2xs text-muted-foreground shadow">
      <span className="text-cyan-400">{cfg.label}={p.value.toFixed(cfg.decimals)}</span>
      <span className="ml-2 text-foreground">K=${p.strike.toFixed(0)}</span>
      <span className="ml-2">{(p.moneyness * 100).toFixed(0)}%</span>
      <span className="ml-2">{Math.round(p.dte)}d</span>
    </div>
  );
}

function InspectPanel3D({ p, cfg }: { p: InspectPt | null; cfg: typeof GREEKS[number] }) {
  if (!p) return null;
  return (
    <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded border border-border bg-card/95 px-3 py-2 font-mono text-type-xs shadow-lg">
      <div className="mb-1 text-center text-type-2xs uppercase tracking-wider text-foreground">Greek Inspection</div>
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted-foreground">
        <span className="text-cyan-400">{cfg.label}</span><span className="tabular-nums text-right text-cyan-400">{p.value.toFixed(cfg.decimals)}</span>
        <span>Strike</span><span className="tabular-nums text-right text-foreground">${p.strike.toFixed(0)}</span>
        <span>Moneyness</span><span className="tabular-nums text-right text-foreground">{(p.moneyness * 100).toFixed(0)}%</span>
        <span>Zone</span><span className="tabular-nums text-right font-bold" style={{ color: p.moneyness < 0.95 ? '#22c55e' : p.moneyness > 1.05 ? '#ef4444' : '#f59e0b' }}>
          {p.moneyness < 0.95 ? 'ITM' : p.moneyness > 1.05 ? 'OTM' : 'ATM'}
        </span>
        <span>DTE</span><span className="tabular-nums text-right text-foreground">{Math.round(p.dte)}d</span>
        <span>Side</span><span className="tabular-nums text-right text-foreground">{p.side}</span>
      </div>
    </div>
  );
}

interface InspectPt { strike: number; moneyness: number; dte: number; value: number; side: string }

// ── Main ───────────────────────────────────────────────────────────────────

interface Props { surface: SurfaceData | null; underlyingPrice: number | undefined; loading?: boolean }

export function CryptoGreeksSurface({ surface, underlyingPrice: S, loading }: Props) {
  const [wireframe, setWireframe] = useState(false);
  const [field, setField] = useState<GreekField>('delta');
  const [hover, setHover] = useState<InspectPt | null>(null);
  const [sel, setSel] = useState<InspectPt | null>(null);
  const info = useGreekGeo(surface, S, field);
  const cfg = GREEKS.find(g => g.key === field)!;

  const buildPt = useCallback((px: number, pz: number): InspectPt | null => {
    if (!info || !S) return null;
    const zi = Math.round((pz / 3.2 + 0.5) * (info.nZ2 - 1));
    const ei = Math.round(zi / 4);
    if (ei < 0 || ei >= info.dtes.length) return null;
    let bx = 0, bd = Infinity;
    for (let i = 0; i < info.xs.length; i++) { const d = Math.abs(info.xs[i]! - px); if (d < bd) { bd = d; bx = i; } }
    const mn = info.mnV[bx]!, strike = mn * S;
    const z2 = Math.round(ei * 4), x2 = Math.round(bx * 4);
    const arr = (info.geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const py = z2 < info.nZ2 && x2 < info.nX2 ? arr[(z2 * info.nX2 + x2) * 3 + 1]! : 0;
    const range = info.max - info.min || 1;
    const val = info.min + (py / 1.7) * range;
    let side = 'call';
    if (surface) {
      const closest = surface.points.reduce<any>((b, p) => {
        const d = Math.abs(p.strike / S - mn) + Math.abs(p.dte - info.dtes[ei]!) * 0.1;
        return !b || d < b._d ? Object.assign(p, { _d: d }) : b;
      }, null);
      if (closest && closest._d < 0.3) side = closest.side;
    }
    return { strike, moneyness: mn, dte: info.dtes[ei]!, value: val, side: side || (mn >= 1 ? 'call' : 'put') };
  }, [info, S, surface]);

  const handleMove = useCallback((e: THREE.Event) => { (e as any).stopPropagation?.(); setHover(buildPt((e as any).point.x, (e as any).point.z)); }, [buildPt]);

  if (loading) return <div className="flex h-full items-center justify-center font-mono text-type-xs text-muted-foreground">Loading Greeks…</div>;
  if (!surface || !S) return <div className="flex h-full items-center justify-center font-mono text-type-xs text-muted-foreground">No Greeks data</div>;

  return (
    <div className="relative h-full w-full">
      <Canvas camera={{ position: [3.4, 2.8, 3.8], fov: 42 }} gl={{ antialias: true, alpha: false }} style={{ background: 'var(--background)' }}>
        <ambientLight intensity={0.45} />
        <directionalLight position={[5, 10, 5]} intensity={0.8} />
        <OrbitControls enablePan={false} target={[0, 0.5, 0]} minPolarAngle={Math.PI / 6} maxPolarAngle={Math.PI / 2.2} minDistance={2} maxDistance={9} />
        {info && <><Mesh3D geo={info.geo} wireframe={wireframe} onMove={handleMove} /><AtmLine px={info.atmPx} /><Axes3D info={info} field={field} cfg={cfg} /></>}
      </Canvas>
      {info && <Legend3D lo={info.min} hi={info.max} field={field} cfg={cfg} />}
      <HoverBadge p={hover} field={field} cfg={cfg} />
      <InspectPanel3D p={sel} cfg={cfg} />

      <div className="absolute left-3 top-3 flex flex-col gap-2">
        <div className="flex gap-0.5 rounded border border-border bg-card p-0.5">
          {GREEKS.map(g => (
            <button key={g.key} type="button" onClick={() => { setField(g.key); setSel(null); }}
              className={`rounded px-1.5 py-0.5 font-mono text-type-2xs transition-colors ${field === g.key ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              {g.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setWireframe(f => !f)}
          className="rounded border border-border bg-card px-2 py-1 font-mono text-type-xs text-muted-foreground hover:bg-muted">
          {wireframe ? 'Solid' : 'Wireframe'}
        </button>
        {info && <div className="rounded border border-border bg-card/80 px-2 py-1 font-mono text-type-2xs text-muted-foreground">
          <div>Spot <span className="text-foreground tabular-nums">${S.toFixed(0)}</span></div>
          <div>{cfg.label} <span className="text-cyan tabular-nums">{info.min.toFixed(cfg.decimals)}–{info.max.toFixed(cfg.decimals)}</span></div>
          <div>Expiries <span className="text-foreground tabular-nums">{info.dtes.length}</span></div>
        </div>}
      </div>

      {!sel && <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 font-mono text-type-2xs text-muted-foreground/50">Click a point to inspect</div>}
    </div>
  );
}
