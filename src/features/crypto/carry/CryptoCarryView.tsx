import { toFundingSnapshot } from '../../../lib/math/carry/funding';
import { computeBasis } from '../../../lib/math/carry/basis';

export function CryptoCarryView() {
  const now = Date.now();
  const funding = toFundingSnapshot('Deribit','BTC-PERP',0.00012, now, { premium: 0.0005 });
  const basis = computeBasis(60000, 60150, now+30*864e5, now, { instrument: 'BTC-27DEC24' });
  return (
    <div data-testid="carry-workstation" className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded border p-3">
          <div className="font-mono text-xs font-bold uppercase">Perpetual Funding (Deribit)</div>
          <div className="mt-2 font-mono text-xs">Native 8h: {(funding.rawRate8h*100).toFixed(4)}% · Annualized (simple): {(funding.simpleAnnualizedRunRate*100).toFixed(2)}% <span className="text-muted-foreground">(simpleAnnualizedRunRate, not yield)</span></div>
          <div className="mt-1 font-mono text-[10px] text-muted-foreground">Direction: {funding.direction} · Premium {(funding.premium!*100).toFixed(3)}% · {new Date(funding.timestamp).toISOString().slice(11,19)}Z</div>
        </div>
        <div className="rounded border p-3">
          <div className="font-mono text-xs font-bold uppercase">Dated Basis (BTC-27DEC24)</div>
          {basis ? (
            <div className="mt-2 font-mono text-xs">
              <div>Absolute: {basis.absolute.toFixed(1)} · %: {(basis.percentage*100).toFixed(3)}%</div>
              <div>Simple ann: {(basis.simpleAnnualized*100).toFixed(2)}% · Log ann: {(basis.logAnnualized*100).toFixed(2)}% <span className="text-muted-foreground">(distinct)</span></div>
              <div className="mt-1 text-[10px] text-muted-foreground">DTE {basis.dte.toFixed(0)} · Spot {basis.spot} · Future {basis.futurePrice}</div>
            </div>
          ) : <div className="font-mono text-xs">Unavailable</div>}
        </div>
      </div>
      <div className="rounded border p-2 font-mono text-[10px] text-muted-foreground">Perpetual funding stays separate from dated maturity; no unlabeled APR; no synthetic missing expiry.</div>
    </div>
  );
}
