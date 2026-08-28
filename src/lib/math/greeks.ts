import { normCdf, normPdf } from './norm';
import type { DecimalRate, DecimalVol, YearFraction } from './units';
import type { GreeksRaw } from './contracts';

/**
 * Raw analytic Greeks — mathematical derivatives, not display-scaled.
 * delta = dV/dS, gamma = d2V/dS2, theta per year, vega per 1.0 vol, rho per 1.0 rate,
 * vanna = d delta / d vol (per 1.0 vol), charm = -d delta / dT per year.
 */
export function greeksEuropean(
  side: 'call' | 'put',
  S: number,
  K: number,
  T: YearFraction,
  r: DecimalRate,
  q: DecimalRate,
  vol: DecimalVol,
): GreeksRaw {
  const t = T as number;
  const sigma = vol as number;
  const rr = r as number;
  const qq = q as number;
  if (!(S > 0) || !(K > 0) || !(t > 0) || !(sigma > 0) || !isFinite(sigma)) {
    return { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, vanna: 0, charm: 0 };
  }
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(S / K) + (rr - qq + 0.5 * sigma * sigma) * t) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const dfQ = Math.exp(-qq * t);
  const dfR = Math.exp(-rr * t);
  const nd1 = normPdf(d1);
  const gamma = (dfQ * nd1) / (S * sigma * sqrtT);
  const vega = S * dfQ * nd1 * sqrtT;

  let delta: number;
  let theta: number;
  let rho: number;
  if (side === 'call') {
    delta = dfQ * normCdf(d1);
    theta = (-dfQ * S * nd1 * sigma) / (2 * sqrtT) - rr * K * dfR * normCdf(d2) + qq * S * dfQ * normCdf(d1);
    rho = K * t * dfR * normCdf(d2);
  } else {
    delta = -dfQ * normCdf(-d1);
    theta = (-dfQ * S * nd1 * sigma) / (2 * sqrtT) + rr * K * dfR * normCdf(-d2) - qq * S * dfQ * normCdf(-d1);
    rho = -K * t * dfR * normCdf(-d2);
  }

  // Charm = -dΔ/dT per year (Haug / MacroVol Python cross-language form).
  // term = n(d1)·(2(r−q)T − d2·σ·√T)/(2T·σ·√T)  (= n(d1)·∂d1/∂T); the dividend
  // term ±q·N(±d1) is call/put specific:
  //   call: charm = −e^{−qT}·(term − q·N(d1))    put: charm = −e^{−qT}·(term + q·N(−d1))
  const vannaRaw = -dfQ * nd1 * d2 / sigma;
  const charmTerm = nd1 * (2 * (rr - qq) * t - d2 * sigma * sqrtT) / (2 * t * sigma * sqrtT);
  const charm =
    side === 'call'
      ? -dfQ * (charmTerm - qq * normCdf(d1))
      : -dfQ * (charmTerm + qq * normCdf(-d1));

  return { delta, gamma, theta, vega, rho, vanna: vannaRaw, charm };
}
