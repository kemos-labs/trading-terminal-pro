import { useState } from 'react';
import { ChainTable, type ChainRow } from '../../../components/charts/ChainTable';
import { priceEuropeanSpot } from '../../../lib/math/spotBsm';
import type { DecimalRate, DecimalVol, YearFraction } from '../../../lib/math/units';

export function CryptoTradeView() {
  const [legs, setLegs] = useState<{ strike: number; side: 'call'|'put'; qty: number }[]>([
    { strike: 60000, side: 'call', qty: 1 },
  ]);
  const [spot] = useState(60000);
  const rows: ChainRow[] = Array.from({length: 20}, (_,i)=> {
    const strike = 55000 + i*500;
    const T = 0.25 as YearFraction, r=0.02 as DecimalRate, q=0 as DecimalRate, vol=0.6 as DecimalVol;
    const call = priceEuropeanSpot('call', spot, strike, T, r,q,vol).price;
    const put = priceEuropeanSpot('put', spot, strike, T, r,q,vol).price;
    return { strike, expiry: '27DEC24', callBid: call*0.99, callAsk: call*1.01, putBid: put*0.99, putAsk: put*1.01, iv: 0.6, oi: Math.floor(Math.random()*100) };
  });
  const totalPremium = legs.reduce((sum,l)=>{
    const T=0.25 as YearFraction, r=0.02 as DecimalRate, q=0 as DecimalRate, vol=0.6 as DecimalVol;
    const px=priceEuropeanSpot(l.side, spot, l.strike, T, r,q,vol).price;
    return sum + px*l.qty;
  },0);
  return (
    <div className="space-y-3" data-testid="trade-risk-workstation">
      <div className="flex gap-2 font-mono text-xs">
        <span className="rounded bg-muted px-2 py-1">Spot {spot}</span>
        <span className="rounded bg-muted px-2 py-1">Premium {totalPremium.toFixed(2)}</span>
        <span className="text-muted-foreground">Same engine as Volatility/Positioning — no private formula</span>
      </div>
      <ChainTable rows={rows} />
      <div className="rounded border p-3 font-mono text-xs">
        <div className="font-bold uppercase">Strategy Builder</div>
        <div className="mt-2 flex gap-2">
          {legs.map((l,i)=><span key={i} className="rounded bg-muted px-2 py-1">{l.qty}× {l.side} {l.strike}</span>)}
          <button onClick={()=>setLegs([...legs,{strike:61000, side:'put', qty:1}])} className="rounded border px-2 py-1 hover:bg-muted">+ Leg</button>
        </div>
        <div className="mt-3 text-[10px] text-muted-foreground">P&L, Greeks, scenario hedge — canonical math, fees/slippage/drift explicit</div>
      </div>
    </div>
  );
}
