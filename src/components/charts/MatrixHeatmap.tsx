import { useEffect, useRef } from 'react';

export interface HeatmapCell { x: number; y: number; value: number | null; label?: string; }

export function MatrixHeatmap({ data, xLabels, yLabels, title }: { data: (number | null)[][]; xLabels: string[]; yLabels: string[]; title?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const W = 480, H = 280, padL = 50, padT = 20;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0,0,W,H);
    if (!data.length) return;
    const cols = data[0]!.length;
    const rows = data.length;
    const cellW = (W - padL - 10) / Math.max(1, cols);
    const cellH = (H - padT - 20) / Math.max(1, rows);
    // Compute domain for diverging symmetric scale centered at 0 if signed
    const flat = data.flat().filter(v=>v!=null) as number[];
    const hasNeg = flat.some(v=>v<0);
    const maxAbs = Math.max(...flat.map(v=>Math.abs(v)), 1);
    const domain = hasNeg ? maxAbs : Math.max(...flat, 1);
    for (let r=0; r<rows; r++) {
      for (let c=0; c<cols; c++) {
        const v = data[r]![c];
        const x = padL + c*cellW;
        const y = padT + r*cellH;
        if (v == null) {
          ctx.fillStyle = '#1f2428';
          ctx.fillRect(x,y,cellW-1,cellH-1);
          ctx.strokeStyle = '#2a3238';
          ctx.strokeRect(x+2,y+2,cellW-6,cellH-6);
        } else {
          const t = hasNeg ? (v / domain) : (v / domain);
          const alpha = Math.min(1, Math.abs(t));
          if (hasNeg) {
            ctx.fillStyle = v>0 ? `rgba(16,185,129,${0.15+alpha*0.85})` : `rgba(239,68,68,${0.15+alpha*0.85})`;
          } else {
            ctx.fillStyle = `rgba(59,130,246,${0.15+alpha*0.85})`;
          }
          ctx.fillRect(x,y,cellW-1,cellH-1);
        }
      }
    }
    // Labels
    ctx.fillStyle = '#8b919c';
    ctx.font = '10px monospace';
    xLabels.forEach((lbl,i)=> ctx.fillText(lbl, padL + i*cellW + 2, H-6));
    yLabels.forEach((lbl,i)=> ctx.fillText(lbl, 4, padT + i*cellH + 12));
    if (title) { ctx.fillStyle = '#e8eaed'; ctx.fillText(title, padL, 12); }
  }, [data, xLabels, yLabels, title]);

  return (
    <div className="overflow-hidden rounded border bg-card p-2">
      <canvas ref={ref} width={W} height={H} className="block" aria-label={title ?? 'Heatmap'} />
      <div className="mt-1 font-mono text-[10px] text-muted-foreground">Diverging scale centered at 0 for signed exposure; missing cells distinct from zero.</div>
    </div>
  );
}
