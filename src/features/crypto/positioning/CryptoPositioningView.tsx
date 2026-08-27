import { MatrixHeatmap } from '../../../components/charts/MatrixHeatmap';
import { aggregateExposure } from '../../../lib/math/positioning/exposure';

export function CryptoPositioningView() {
  const strikes = ['55k','57.5k','60k','62.5k','65k'];
  const expiries = ['1W','2W','1M','3M'];
  // Mock OI with some nulls to prove missing vs zero distinction
  const gexData: (number | null)[][] = [
    [120,  -80,  45, null,  10 ],
    [200,  null, 90, -30,  15 ],
    [null, 150,  60,  20, null],
    [ 80,   40, null,  5,  -5 ],
  ];
  const rows = gexData.flatMap((row, r) => row.map((gex, c) => ({
    strike: 55000 + c*2500,
    expiryMs: Date.now() + (r+1)*7*864e5,
    oi: gex==null ? null : Math.abs(gex)*10,
    gamma: gex==null ? 0 : gex/1e6,
    delta: 0.5,
    vannaRaw: 0.1,
    charmRaw: -0.05,
    spot: 60000,
  })));
  const { total } = aggregateExposure(rows, () => 1);
  return (
    <div data-testid="positioning-workstation" className="space-y-3">
      <div className="flex flex-wrap gap-2 font-mono text-xs">
        <span className="rounded bg-amber-500/20 px-2 py-1 text-amber-800">Exposure proxy — OI-weighted, not dealer book</span>
        <span className="rounded bg-muted px-2 py-1">Sign model: Calls + / Puts − (naive)</span>
        <span className="rounded bg-muted px-2 py-1">Shock: per 1% spot move</span>
        <span className="rounded bg-muted px-2 py-1">Coverage {((total.coverage ?? 0)*100).toFixed(0)}% ({rows.length - (total.missingOiCount ?? 0)}/{rows.length})</span>
      </div>
      <MatrixHeatmap data={gexData} xLabels={strikes} yLabels={expiries} title="GEX per 1% (signed) — diverging symmetric, missing = distinct" />
      <div className="rounded border p-2 font-mono text-[10px] text-muted-foreground">GEX = sign·gamma·Q·S²·0.01 — null differs from zero; unclipped tooltip exact value; fixed domain for comparison.</div>
    </div>
  );
}
