/**
 * MM-style hedge-flow brief + risk-budget geometry.
 * Interprets listed OI GEX/VEX/Charm (customer-long OI → dealers short convention).
 * Educational path bias — not a trade signal.
 */
import { normCdf } from '../math/norm';
import { yearFractionFromSlice } from './time';

export type HedgeFlowInputs = {
  totalGEX: number;
  totalVEX: number;
  totalCharm: number;
  spot: number;
  gammaFlip: number | null;
};

export type HedgeFlowBrief = {
  /** One-line regime headline */
  headline: string;
  /** Primary dealer rehedge path bias (γ / charm / vanna) */
  bias: string;
  /** When charm and vanna conflict */
  interaction: string | null;
  /** Time-of-day framing for charm weight */
  sessionNote: string;
  tone: 'up' | 'down' | 'warn' | 'neutral';
};

function signMag(x: number, eps: number): -1 | 0 | 1 {
  if (!Number.isFinite(x) || Math.abs(x) < eps) return 0;
  return x > 0 ? 1 : -1;
}

/**
 * Interpret net dealer exposures into a plain-English hedge-flow brief.
 *
 * Sign convention (matches dealerExposure): customer long listed OI ⇒ dealers short.
 * - Short γ (GEX−): dealers buy rips / sell dips → amplifies moves ("toxic" / unstable).
 * - Long γ (GEX+): dealers sell rips / buy dips → dampens.
 * - Charm (Σ $Δ/day of listed OI): as time passes, if OI delta rises, dealers short that
 *   inventory rehedge by selling underlier (and vice versa).
 * - VEX: dealer delta vs IV — vol drop often reduces short-call delta → buy-back hedges, etc.
 */
export function interpretHedgeFlow(inp: HedgeFlowInputs): HedgeFlowBrief {
  const { totalGEX, totalVEX, totalCharm, spot, gammaFlip } = inp;
  const gexEps = Math.max(Math.abs(totalGEX) * 1e-6, 1);
  const gSign = signMag(totalGEX, gexEps);
  const cSign = signMag(totalCharm, Math.max(Math.abs(totalCharm) * 1e-6, 1));
  const vSign = signMag(totalVEX, Math.max(Math.abs(totalVEX) * 1e-6, 1));

  const aboveFlip =
    gammaFlip != null && Number.isFinite(gammaFlip) && Number.isFinite(spot)
      ? spot >= gammaFlip
      : null;

  let headline: string;
  let tone: HedgeFlowBrief['tone'];
  if (gSign < 0) {
    headline =
      aboveFlip === false
        ? 'Toxic short-γ below flip — thin MM liquidity, wider path range'
        : 'Net short-γ inventory — hedges can amplify spot moves';
    tone = 'down';
  } else if (gSign > 0) {
    headline =
      aboveFlip === true
        ? 'Long-γ dampening above flip — mean-revert bias into walls'
        : 'Net long-γ inventory — dips/rips more likely absorbed';
    tone = 'up';
  } else {
    headline = 'Flat / mixed γ — walls matter more than net GEX';
    tone = 'warn';
  }

  let bias: string;
  if (cSign > 0) {
    bias =
      'Charm: listed Δ rises with time → under dealer-short OI, expect futures selling to rehedge (pin / grind lower bias if γ is also short).';
  } else if (cSign < 0) {
    bias =
      'Charm: listed Δ falls with time → under dealer-short OI, expect futures buying to rehedge (support / grind higher bias if uncontested).';
  } else {
    bias = 'Charm near flat — little overnight Δ bleed; focus on walls, flip, and active flow.';
  }

  let interaction: string | null = null;
  // Classic conflict: charm sells while vol-drop vanna buys (or reverse).
  // VEX sign is inventory-level; we only flag when charm and VEX disagree strongly.
  if (cSign !== 0 && vSign !== 0 && cSign !== vSign) {
    interaction =
      'Charm vs vanna conflict: time-decay rehedges and vol-change rehedges pull opposite ways — path is contingent, not a one-way tape.';
    tone = 'warn';
  } else if (cSign !== 0 && vSign === cSign && gSign < 0) {
    interaction =
      'Charm and vanna aligned on a short-γ book — hedge flows can reinforce a directional grind until a wall or flip.';
  }

  const sessionNote =
    'Session: morning moves are often active / vanna-heavy; mid-session passive periods weight charm more. OPEX / 0DTE concentrate both.';

  return { headline, bias, interaction, sessionNote, tone };
}

export type RiskBudget = {
  /** ATM call ≈ 0.4 · S · σ√T (BS rule of thumb) */
  atmPremiumApprox: number;
  /** Live ATM straddle mid when available */
  straddle: number;
  /** Stop distance matching option premium risk budget (≈ C) */
  stopAtPremium: number;
  /** ≈ P(touch) for barrier at premium under zero-drift BM (~0.69 when d≈0.4) */
  probTouchPremium: number;
  /** Stop distance for ~50% touch: ≈ 0.67 · S · σ√T ≈ 1.67 · C */
  stopAtHalfTouch: number;
  /** Always ~0.5 by construction of the 0.67σ level under BM */
  probTouchHalf: number;
  sigma: number;
  T: number;
  spot: number;
};

/**
 * Perp-with-stop vs long option risk-budget geometry (ATM approx).
 * C ≈ 0.4 S σ√T; P(touch at C) ≈ 2 N(-0.4) ≈ 69%; 50% touch at ~0.67 S σ√T.
 */
export function riskBudgetGeometry(opts: {
  spot: number;
  atmIV: number;
  dte: number;
  /** YYYY-MM-DD when known — enables continuous T to 16:00 ET */
  expiry?: string;
  /** Optional live straddle mid; used only for display comparison */
  straddle?: number;
}): RiskBudget {
  const spot = opts.spot;
  const sigma = Math.max(opts.atmIV > 0 ? opts.atmIV : 0.2, 0.01);
  const T = opts.expiry
    ? yearFractionFromSlice({ expiry: opts.expiry, dte: opts.dte })
    : Math.max(opts.dte / 365, 1e-8);
  const volTime = spot * sigma * Math.sqrt(T);
  const atmPremiumApprox = 0.4 * volTime;
  const stopAtPremium = atmPremiumApprox;
  const dPrem = stopAtPremium / (volTime + 1e-12); // ~0.4
  const probTouchPremium = Math.min(0.99, Math.max(0, 2 * (1 - normCdf(Math.abs(dPrem)))));
  const stopAtHalfTouch = 0.67 * volTime;
  const dHalf = stopAtHalfTouch / (volTime + 1e-12);
  const probTouchHalf = Math.min(0.99, Math.max(0, 2 * (1 - normCdf(Math.abs(dHalf)))));

  return {
    atmPremiumApprox,
    straddle: opts.straddle ?? 0,
    stopAtPremium,
    probTouchPremium,
    stopAtHalfTouch,
    probTouchHalf,
    sigma,
    T,
    spot,
  };
}
