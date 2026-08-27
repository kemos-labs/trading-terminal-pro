export interface ChainRow { strike: number; expiry: string; callBid?: number | null; callAsk?: number | null; putBid?: number | null; putAsk?: number | null; iv?: number | null; oi?: number | null; }

export function ChainTable({ rows, maxRows = 60 }: { rows: ChainRow[]; maxRows?: number }) {
  const display = rows.slice(0, maxRows);
  return (
    <div className="overflow-auto rounded border" style={{ maxHeight: 320 }}>
      <table className="w-full font-mono text-xs">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b text-muted-foreground">
            <th className="p-1 text-left">Strike</th><th className="p-1 text-left">Expiry</th><th className="p-1 text-right">Call Bid/Ask</th><th className="p-1 text-right">Put Bid/Ask</th><th className="p-1 text-right">IV</th><th className="p-1 text-right">OI</th>
          </tr>
        </thead>
        <tbody>
          {display.map((r,i)=>(
            <tr key={i} className="border-b last:border-0 hover:bg-muted/50">
              <td className="p-1">{r.strike}</td><td className="p-1">{r.expiry}</td>
              <td className="p-1 text-right">{r.callBid ?? '—'}/{r.callAsk ?? '—'}</td>
              <td className="p-1 text-right">{r.putBid ?? '—'}/{r.putAsk ?? '—'}</td>
              <td className="p-1 text-right">{r.iv != null ? (r.iv*100).toFixed(1)+'%' : '—'}</td>
              <td className="p-1 text-right">{r.oi ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > maxRows && <div className="p-1 text-center font-mono text-[10px] text-muted-foreground">Showing {maxRows} of {rows.length} rows (virtualized cap)</div>}
    </div>
  );
}
