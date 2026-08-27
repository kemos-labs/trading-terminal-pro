export interface LevelAnnotation {
  strike: number;
  label: string;
  kind: 'wall' | 'flip' | 'max-pain' | 'high-oi';
  strength: number;
  expiryMs?: number;
}

export function detectWalls(
  strikes: number[],
  oi: (number | null)[],
  thresholdPct = 0.2,
): LevelAnnotation[] {
  const maxOi = Math.max(...oi.filter(v => v != null) as number[], 0);
  if (maxOi <= 0) return [];
  const out: LevelAnnotation[] = [];
  for (let i = 0; i < strikes.length; i++) {
    const v = oi[i];
    if (v != null && v >= maxOi * (1 - thresholdPct)) {
      out.push({ strike: strikes[i]!, label: `OI wall ${v.toFixed(0)}`, kind: 'wall', strength: v / maxOi });
    }
  }
  return out;
}

export function flipStrike(
  strikes: number[],
  gex: (number | null)[],
): number | null {
  // First strike where cumulative GEX changes sign
  let cum = 0;
  let prevSign = Math.sign(gex[0] ?? 0);
  for (let i = 0; i < strikes.length; i++) {
    cum += gex[i] ?? 0;
    const s = Math.sign(cum);
    if (s !== 0 && prevSign !== 0 && s !== prevSign) return strikes[i] ?? null;
    if (s !== 0) prevSign = s;
  }
  return null;
}
