export function CryptoFlowView() {
  const trades = [
    { time: '12:01:03', side: 'buy', price: 60012, qty: 0.5, premium: 1200, confidence: 'high' },
    { time: '12:01:07', side: 'sell', price: 60010, qty: 1.2, premium: 2880, confidence: 'high' },
    { time: '12:01:12', side: 'buy', price: 60015, qty: 0.3, premium: 720, confidence: 'medium' },
  ] as const;
  return (
    <div data-testid="flow-workstation" className="space-y-3">
      <div className="flex flex-wrap gap-2 font-mono text-xs">
        <span className="rounded bg-muted px-2 py-1">Taker side only — not opening/closing, not dealer identity</span>
        <span className="rounded bg-muted px-2 py-1">Source: Deribit trades</span>
        <span className="rounded bg-muted px-2 py-1">Coverage 3 trades</span>
      </div>
      <div className="rounded border">
        <div className="grid grid-cols-5 gap-2 border-b bg-muted/40 p-2 font-mono text-[10px] font-bold uppercase">
          <div>Time</div><div>Side</div><div>Qty</div><div>Premium</div><div>Confidence</div>
        </div>
        {trades.map((t,i)=>(
          <div key={i} className="grid grid-cols-5 gap-2 p-2 font-mono text-xs hover:bg-muted/30">
            <div>{t.time}</div><div className={t.side==='buy'?'text-emerald-600':'text-red-600'}>{t.side}</div><div>{t.qty}</div><div>{t.premium}</div><div>{t.confidence}</div>
          </div>
        ))}
      </div>
      <div className="rounded border p-2 font-mono text-[10px] text-muted-foreground">Premium matrix by side/moneyness/expiry — separate from OI. Block/RFQ only where real feed exists.</div>
    </div>
  );
}
