// GENERATED — do not edit. Source: src/lib/options/exposureGrid.ts + src/lib/math/*. Regenerate: node scripts/build-exposure-grid-bundle.mjs

// src/lib/math/norm.ts
var SQRT_2PI = Math.sqrt(2 * Math.PI);
function normPdf(x) {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}
function normCdf(x) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

// src/lib/math/greeks.ts
function greeksEuropean(side, S, K, T, r, q, vol) {
  const t = T;
  const sigma = vol;
  const rr = r;
  const qq = q;
  if (!(S > 0) || !(K > 0) || !(t > 0) || !(sigma > 0) || !isFinite(sigma)) {
    return { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, vanna: 0, charm: 0 };
  }
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(S / K) + (rr - qq + 0.5 * sigma * sigma) * t) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const dfQ = Math.exp(-qq * t);
  const dfR = Math.exp(-rr * t);
  const nd1 = normPdf(d1);
  const gamma = dfQ * nd1 / (S * sigma * sqrtT);
  const vega = S * dfQ * nd1 * sqrtT;
  let delta;
  let theta;
  let rho;
  if (side === "call") {
    delta = dfQ * normCdf(d1);
    theta = -dfQ * S * nd1 * sigma / (2 * sqrtT) - rr * K * dfR * normCdf(d2) + qq * S * dfQ * normCdf(d1);
    rho = K * t * dfR * normCdf(d2);
  } else {
    delta = -dfQ * normCdf(-d1);
    theta = -dfQ * S * nd1 * sigma / (2 * sqrtT) + rr * K * dfR * normCdf(-d2) - qq * S * dfQ * normCdf(-d1);
    rho = -K * t * dfR * normCdf(-d2);
  }
  const vannaRaw = -dfQ * nd1 * d2 / sigma;
  const charmTerm = nd1 * (2 * (rr - qq) * t - d2 * sigma * sqrtT) / (2 * t * sigma * sqrtT);
  const charm = side === "call" ? -dfQ * (charmTerm - qq * normCdf(d1)) : -dfQ * (charmTerm + qq * normCdf(-d1));
  return { delta, gamma, theta, vega, rho, vanna: vannaRaw, charm };
}

// src/lib/math/black76.ts
function priceEuropeanBlack76(inp) {
  const { forward: F, strike: K, expiryYears: T, rate: r, vol, side } = inp;
  const df = Math.exp(-r * T);
  if (!(F > 0) || !(K > 0)) return { price: 0, model: "black76", forward: F, df, d1: 0, d2: 0 };
  if (!(T > 0)) {
    const intr = side === "call" ? Math.max(0, F - K) : Math.max(0, K - F);
    return { price: df * intr, model: "black76", forward: F, df, d1: 0, d2: 0 };
  }
  if (!(vol > 0) || !isFinite(vol)) {
    const intr = side === "call" ? Math.max(0, F - K) : Math.max(0, K - F);
    return { price: df * intr, model: "black76", forward: F, df, d1: 0, d2: 0 };
  }
  const sigma = vol;
  const t = T;
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(F / K) + 0.5 * sigma * sigma * t) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  let price;
  if (side === "call") price = df * (F * normCdf(d1) - K * normCdf(d2));
  else price = df * (K * normCdf(-d2) - F * normCdf(-d1));
  return { price, model: "black76", forward: F, df, d1, d2 };
}

// src/lib/math/spotBsm.ts
function priceEuropeanSpot(side, S, K, T, r, q, vol) {
  const t = T;
  const forward = S * Math.exp((r - q) * t);
  const res = priceEuropeanBlack76({ forward, strike: K, expiryYears: T, rate: r, vol, side });
  return { price: res.price, forward, df: res.df };
}

// src/lib/math/units.ts
function asDecimalRate(v) {
  return v;
}
function asDecimalVol(v) {
  return v;
}
function asYearFraction(v) {
  return v;
}
function thetaPerDay(thetaPerYear) {
  return thetaPerYear / 365;
}
function vegaPerVolPoint(vegaRaw) {
  return vegaRaw / 100;
}
function charmPerDay(charmRaw) {
  return charmRaw / 365;
}

// src/lib/math/adapters.ts
function priceGreeksMarket(side, S, K, T, r, q, vol) {
  const t = T;
  const finite = [S, K, T, r, q, vol].every(Number.isFinite);
  if (!finite || !(S > 0) || !(K > 0)) {
    return { price: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, vanna: 0, volga: 0, charm: 0, speed: 0, veta: 0, color: 0, zomma: 0, ultima: 0 };
  }
  const priceRes = priceEuropeanSpot(side, S, K, asYearFraction(t), asDecimalRate(r), asDecimalRate(q), asDecimalVol(vol));
  if (!(t > 0) || !(vol > 0)) {
    const discountedSpot = S * Math.exp(-q * t);
    const discountedStrike = K * Math.exp(-r * t);
    const atm = Math.abs(discountedSpot - discountedStrike) < 1e-12;
    const delta = side === "call" ? discountedSpot > discountedStrike ? Math.exp(-q * t) : atm ? 0.5 * Math.exp(-q * t) : 0 : discountedSpot < discountedStrike ? -Math.exp(-q * t) : atm ? -0.5 * Math.exp(-q * t) : 0;
    return {
      price: priceRes.price,
      delta,
      gamma: 0,
      theta: 0,
      vega: 0,
      rho: 0,
      vanna: 0,
      volga: 0,
      charm: 0,
      speed: 0,
      veta: 0,
      color: 0,
      zomma: 0,
      ultima: 0
    };
  }
  const raw = greeksEuropean(side, S, K, asYearFraction(t), asDecimalRate(r), asDecimalRate(q), asDecimalVol(vol));
  const volSqrtT = vol * Math.sqrt(t);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * vol * vol) * t) / volSqrtT;
  const d2 = d1 - volSqrtT;
  const eq = Math.exp(-q * t);
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  const vegaRaw = raw.vega;
  const gammaRaw = raw.gamma;
  return {
    price: priceRes.price,
    delta: raw.delta,
    gamma: raw.gamma,
    theta: thetaPerDay(raw.theta),
    vega: vegaPerVolPoint(raw.vega),
    rho: raw.rho,
    vanna: raw.vanna,
    volga: vegaRaw * d1 * d2 / vol,
    charm: charmPerDay(raw.charm),
    speed: -gammaRaw * (d1 / volSqrtT + 1 / S),
    veta: -S * eq * pdf * Math.sqrt(t) * (q + (r - q) * d1 / volSqrtT - (1 + d1 * d2) / (2 * t)),
    color: -eq * pdf / (S * volSqrtT) * (2 * q * t + 1 + (2 * (r - q) * t - d2 * volSqrtT) * d1 / volSqrtT) / (2 * t),
    zomma: gammaRaw * (d1 * d2 - 1) / vol,
    ultima: -vegaRaw * (d1 * d2 * (1 - d1 * d2) + d1 * d1 + d2 * d2) / (vol * vol)
  };
}

// src/lib/options/exposureGrid.ts
var MS_PER_YEAR_ACT365_25 = 365.25 * 24 * 3600 * 1e3;
var EXPOSURE_GRID_MAX_EVALS = 25e4;
var EXPOSURE_GRID_MAX_AXIS = 500;
function isFiniteNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function buildExposureGrid(input) {
  const { quotes, prices, timesMs, metric } = input;
  if (!Array.isArray(quotes) || !Array.isArray(prices) || !Array.isArray(timesMs)) {
    throw new RangeError("exposure-grid: quotes/prices/timesMs must be arrays");
  }
  if (prices.length === 0 || timesMs.length === 0) {
    throw new RangeError("exposure-grid: prices and timesMs must be non-empty");
  }
  if (prices.length > EXPOSURE_GRID_MAX_AXIS || timesMs.length > EXPOSURE_GRID_MAX_AXIS) {
    throw new RangeError("exposure-grid: axis exceeds max length");
  }
  for (let i = 0; i < prices.length; i++) {
    if (!isFiniteNum(prices[i]) || !(prices[i] > 0)) {
      throw new RangeError(`exposure-grid: prices[${i}] must be finite > 0`);
    }
    if (i > 0 && !(prices[i] > prices[i - 1])) {
      throw new RangeError("exposure-grid: prices must be strictly increasing (no duplicates)");
    }
  }
  for (let i = 0; i < timesMs.length; i++) {
    if (!isFiniteNum(timesMs[i])) {
      throw new RangeError(`exposure-grid: timesMs[${i}] must be finite`);
    }
    if (i > 0 && !(timesMs[i] > timesMs[i - 1])) {
      throw new RangeError("exposure-grid: timesMs must be strictly increasing (no duplicates)");
    }
  }
  if (metric !== "gex" && metric !== "charm" && metric !== "dex") {
    throw new RangeError("exposure-grid: metric must be 'gex', 'charm' or 'dex'");
  }
  if (prices.length * timesMs.length * Math.max(quotes.length, 1) > EXPOSURE_GRID_MAX_EVALS) {
    throw new RangeError("exposure-grid: grid size exceeds computational bound");
  }
  const warnings = [];
  let totalIncluded = 0;
  let totalExpired = 0;
  let totalMissing = 0;
  const reasonSet = /* @__PURE__ */ new Set();
  const cells = prices.map(
    (S) => timesMs.map((t) => {
      let acc = 0;
      let included = 0;
      let excludedExpired = 0;
      let missing = 0;
      const reasons = [];
      const note = (r) => {
        if (!reasons.includes(r)) reasons.push(r);
        reasonSet.add(r);
      };
      for (const qq of quotes) {
        if (!isFiniteNum(qq.expiryMs)) {
          missing++;
          note("missing-expiry");
          continue;
        }
        if (t >= qq.expiryMs) {
          excludedExpired++;
          note("expired");
          continue;
        }
        if (qq.modelId !== "spot-european") {
          missing++;
          note("unsupported-model");
          continue;
        }
        if (!isFiniteNum(S) || !(S > 0) || !isFiniteNum(qq.strike) || !(qq.strike > 0)) {
          missing++;
          note("invalid-spot-strike");
          continue;
        }
        if (!isFiniteNum(qq.iv) || !(qq.iv > 0)) {
          missing++;
          note("missing-iv");
          continue;
        }
        if (!isFiniteNum(qq.r) || !isFiniteNum(qq.q)) {
          missing++;
          note("missing-rates");
          continue;
        }
        if (qq.openInterest == null) {
          missing++;
          note("missing-oi");
          continue;
        }
        if (!isFiniteNum(qq.openInterest) || qq.openInterest < 0) {
          missing++;
          note("missing-oi");
          continue;
        }
        if (!isFiniteNum(qq.multiplier) || !(qq.multiplier > 0)) {
          missing++;
          note("invalid-multiplier");
          continue;
        }
        if (qq.openInterest === 0) {
          included++;
          continue;
        }
        const T = (qq.expiryMs - t) / MS_PER_YEAR_ACT365_25;
        if (!isFiniteNum(T) || !(T > 0)) {
          missing++;
          note("missing-expiry");
          continue;
        }
        const g = priceGreeksMarket(
          qq.type,
          S,
          qq.strike,
          T,
          qq.r,
          qq.q,
          qq.iv
        );
        const raw = metric === "gex" ? g.gamma : metric === "charm" ? g.charm : g.delta;
        if (!isFiniteNum(raw)) {
          missing++;
          note("non-finite-exposure-overflow");
          continue;
        }
        let contrib;
        if (metric === "gex") {
          const sign = qq.type === "call" ? 1 : -1;
          contrib = sign * raw * S * S * 0.01 * qq.openInterest * qq.multiplier;
        } else if (metric === "dex") {
          contrib = raw * S * qq.openInterest * qq.multiplier;
        } else {
          contrib = raw * S * qq.openInterest * qq.multiplier;
        }
        if (!isFiniteNum(contrib)) {
          missing++;
          note("non-finite-exposure-overflow");
          continue;
        }
        acc += contrib;
        if (!isFiniteNum(acc)) {
          missing += included + 1;
          included = 0;
          acc = 0;
          note("non-finite-exposure-overflow");
          break;
        }
        included++;
      }
      totalIncluded += included;
      totalExpired += excludedExpired;
      totalMissing += missing;
      return {
        value: included > 0 ? acc : null,
        included,
        excludedExpired,
        missing,
        reasons
      };
    })
  );
  if (reasonSet.has("missing-iv")) warnings.push("positioning-proxy: some quotes lack valid frozen IV \u2014 cells null");
  if (reasonSet.has("missing-rates")) warnings.push("positioning-proxy: some quotes lack validated r/q \u2014 cells null, no rate defaults applied");
  if (reasonSet.has("missing-oi")) warnings.push("positioning-proxy: some quotes lack valid frozen OI \u2014 unavailable, never volume fallback");
  if (reasonSet.has("invalid-multiplier")) warnings.push("positioning-proxy: some quotes carry invalid contract multiplier \u2014 unavailable, no silent default");
  if (reasonSet.has("missing-expiry")) warnings.push("positioning-proxy: some quotes lack trustworthy expiry instant \u2014 unavailable");
  if (reasonSet.has("unsupported-model")) warnings.push("unsupported-model: futures-european quotes excluded \u2014 no audited gamma/charm adapter (Black-76 exposes price/forward-delta only)");
  if (reasonSet.has("non-finite-exposure-overflow")) warnings.push("non-finite-exposure-overflow: overflowed contributions excluded as null");
  if (reasonSet.has("expired")) warnings.push("expired contracts excluded at exact expiry instant; totals drop");
  return {
    prices: [...prices],
    timesMs: [...timesMs],
    metric,
    cells,
    totals: { included: totalIncluded, excludedExpired: totalExpired, missing: totalMissing },
    units: metric === "gex" ? "$/1% move" : metric === "dex" ? "$\u0394 notional" : "$\u0394/day",
    methodology: {
      version: "exposure-grid/v1",
      signConvention: "signed-greek-oi-proxy",
      positionBasis: `frozen-OI-at-${input.positionBasisAt ?? "snapshot-event-time"}`,
      ivBasis: "sticky-frozen-per-quote",
      timeBasis: "ACT/365.25 from explicit caller-supplied expiry UTC instant (no 16:00-ET inference)",
      charmUnits: "raw -d\u0394/dT per year; per-day = raw/365; dollar-per-day = per-day\xB7S\xB7OI\xB7mult",
      gexUnits: "$ per 1% underlying move (\u03B3\xB7S\xB2\xB70.01\xB7OI\xB7mult)",
      dexUnits: "$\u0394 notional (signed kernel \u03B4\xB7S\xB7OI\xB7mult; call \u03B4 \u2265 0, put \u03B4 \u2264 0, no side negation)",
      settlementRule: input.settlementRule ?? "caller-stated; no default wall clock assumed",
      modelSupport: "spot-european priced; futures-european unsupported (no audited gamma/charm adapter)",
      proxyWarning: "OI-weighted exposure proxy (not observed dealer inventory)"
    },
    warnings
  };
}
export {
  EXPOSURE_GRID_MAX_AXIS,
  EXPOSURE_GRID_MAX_EVALS,
  buildExposureGrid
};
