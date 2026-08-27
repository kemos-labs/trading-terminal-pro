export function CurveChart({ data, label }: { data: { x: number; y: number | null }[]; label?: string }) {
  if (!data.length) return <div className="p-4 font-mono text-xs text-muted-foreground">No data</div>;
  const ys = data.map(d => d.y).filter(v => v != null) as number[];
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 1);
  const w = 400, h = 120, pad = 20;
  const xScale = (x: number) => pad + (x - data[0]!.x) / Math.max(1, data[data.length-1]!.x - data[0]!.x) * (w - pad*2);
  const yScale = (y: number) => h - pad - (y - minY)/(maxY-minY || 1) * (h - pad*2);
  const path = data.filter(d=>d.y!=null).map((d,i)=> `${i===0?'M':'L'} ${xScale(d.x)} ${yScale(d.y!)}`).join(' ');
  return (
    <div className="overflow-hidden rounded border bg-card p-2">
      {label && <div className="mb-1 font-mono text-xs font-bold uppercase">{label}</div>}
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="w-full">
        <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} />
        {data.map((d,i)=> d.y==null ? null : <circle key={i} cx={xScale(d.x)} cy={yScale(d.y!)} r={2} fill="currentColor" />)}
      </svg>
    </div>
  );
}
