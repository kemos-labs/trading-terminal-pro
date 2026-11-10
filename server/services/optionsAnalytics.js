const DAY_MS = 86_400_000;
const DEFAULT_MAX_ROWS = 2_000;
const HARD_MAX_ROWS = 5_000;

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// Abramowitz-Stegun 7.1.26. The approximation error is below 7.5e-8.
function normalCdf(x) {
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * ax);
  const polynomial = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const positive = 1 - normalPdf(ax) * polynomial;
  return x >= 0 ? positive : 1 - positive;
}

function optionState(spot, strike, iv, timeYears, riskFreeRate, carryRate, right) {
  if (![spot, strike, iv, timeYears, riskFreeRate, carryRate].every(Number.isFinite)
    || spot <= 0 || strike <= 0 || iv <= 0 || timeYears <= 0) return null;
  const sqrtT = Math.sqrt(timeYears);
  const d1 = (Math.log(spot / strike) + (riskFreeRate - carryRate + 0.5 * iv * iv) * timeYears) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;
  const discountR = Math.exp(-riskFreeRate * timeYears);
  const discountQ = Math.exp(-carryRate * timeYears);
  const call = right === 'call';
  const delta = call ? discountQ * normalCdf(d1) : discountQ * (normalCdf(d1) - 1);
  const price = call
    ? spot * discountQ * normalCdf(d1) - strike * discountR * normalCdf(d2)
    : strike * discountR * normalCdf(-d2) - spot * discountQ * normalCdf(-d1);
  return { d1, d2, discountQ, delta, price };
}

function modelGreeks(row, { spot, asOfMs, riskFreeRate, carryRate }) {
  if (riskFreeRate == null || carryRate == null || row.iv == null) return null;
  const expiryMs = row.expiryTimeMs;
  const timeYears = (expiryMs - asOfMs) / (365 * DAY_MS);
  const current = optionState(spot, row.strike, row.iv, timeYears, riskFreeRate, carryRate, row.right);
  if (!current) return null;
  const gamma = current.discountQ * normalPdf(current.d1) / (spot * row.iv * Math.sqrt(timeYears));
  const vega = spot * current.discountQ * normalPdf(current.d1) * Math.sqrt(timeYears) / 100;
  const vanna = -current.discountQ * normalPdf(current.d1) * current.d2 / row.iv;
  const next = optionState(spot, row.strike, row.iv, timeYears - (1 / 365), riskFreeRate, carryRate, row.right);
  const theta = next ? next.price - current.price : null;
  const charm = next ? next.delta - current.delta : null;
  const result = { delta: current.delta, gamma, vega, theta, vanna, charm };
  return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, finite(value)]));
}

function expiryFromMs(value) {
  const ms = finite(value);
  if (ms == null || ms <= 0) return null;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

// ── REF-06 forward-volatility matrix ─────────────────────────────────────
// Same total-variance basis as src/lib/math/carry/forwardVol.ts:
// fwdVol = sqrt((sigma2^2*T2 - sigma1^2*T1)/(T2-T1)), annualized, DTE/365.
// REF-06 policy: ANY negative forward variance (including tiny negatives) is
// unavailable (null), never a clamped zero; exact zero with distinct T may be 0.
const FWD_VOL_FORMULA = 'fwdVol = sqrt((sigma2^2*T2 - sigma1^2*T1)/(T2-T1))';
const FWD_VOL_YEAR_FRACTION = 'DTE/365 calendar';
const FWD_VOL_UNITS = 'decimal-volatility (annualized; displayed %)';
const FWD_VOL_MAX_LEGS = 24;

function canonicalForwardVol(sigma1, T1, sigma2, T2) {
  if (![sigma1, sigma2, T1, T2].every(Number.isFinite)) return null;
  if (!(T2 > T1)) return null;
  const fwdVar = sigma2 * sigma2 * T2 - sigma1 * sigma1 * T1;
  if (fwdVar < 0) return null;
  const value = Math.sqrt(fwdVar / (T2 - T1));
  return Number.isFinite(value) ? value : null;
}

function validFwdIv(iv) {
  return typeof iv === 'number' && Number.isFinite(iv) && iv > 0 && iv <= 3;
}

export function buildForwardVolMatrix(envelope, symbol, options = {}) {
  const { rows, limited } = boundedRows(envelope, options.maxRows);
  const spot = finite(envelope?.data?.spot ?? envelope?.data?.indexPrice);
  const asOfMs = Date.parse(envelope?.asOf ?? '');
  const asOfValid = Number.isFinite(asOfMs);
  // Equity canonical quotes carry locally solved mid-price IV (derived);
  // crypto canonical instruments carry observed Deribit mark IV.
  const ivBasis = Array.isArray(envelope?.data?.quotes) ? 'derived-solved-mid' : 'observed-mark';
  const groups = new Map();
  for (const row of rows) {
    if (row.expiry == null) continue;
    if (!groups.has(row.expiry)) groups.set(row.expiry, []);
    groups.get(row.expiry).push(row);
  }
  const allLegs = [];
  for (const [expiry, group] of groups) {
    const expiryMs = group.map((r) => r.expiryTimeMs).find((ms) => Number.isFinite(ms));
    const dte = expiryMs != null && asOfValid ? (expiryMs - asOfMs) / DAY_MS : null;
    const dteValid = typeof dte === 'number' && Number.isFinite(dte) && dte > 0;
    let atmIv = null;
    let atmStrike = null;
    let bestDist = Infinity;
    if (spot != null) {
      for (const r of group) {
        if (!validFwdIv(r.iv) || !(r.strike > 0) || !Number.isFinite(r.strike)) continue;
        const dist = Math.abs(r.strike - spot);
        if (dist < bestDist) { bestDist = dist; atmIv = r.iv; atmStrike = r.strike; }
      }
    }
    allLegs.push({
      expiry,
      dte,
      T: dteValid ? dte / 365 : null,
      atmIv,
      atmStrike,
      quoteCount: group.length,
    });
  }
  allLegs.sort((a, b) => {
    const da = typeof a.dte === 'number' && Number.isFinite(a.dte) ? a.dte : Infinity;
    const db = typeof b.dte === 'number' && Number.isFinite(b.dte) ? b.dte : Infinity;
    return da - db;
  });
  const capped = allLegs.length > FWD_VOL_MAX_LEGS;
  const legs = allLegs.slice(0, FWD_VOL_MAX_LEGS);
  const n = legs.length;
  const cells = [];
  let validCount = 0;
  const missing = new Set();
  if (limited) missing.add('row-limit');
  if (capped) missing.add('expiry-cap');
  if (!asOfValid) missing.add('asof-unavailable');
  if (spot == null) missing.add('spot');
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = legs[i];
      const b = legs[j];
      const base = {
        startIndex: i, endIndex: j,
        startExpiry: a.expiry, endExpiry: b.expiry,
        startDte: a.dte, endDte: b.dte,
        startT: a.T, endT: b.T,
        startAtmIv: a.atmIv, endAtmIv: b.atmIv,
        startAtmStrike: a.atmStrike, endAtmStrike: b.atmStrike,
      };
      if (j <= i) {
        cells.push({ ...base, value: null, structural: true, reason: 'structural' });
        continue;
      }
      if (a.T == null || b.T == null) {
        missing.add('expired-nonfinite-dte');
        cells.push({ ...base, value: null, structural: false, reason: 'expired/nonfinite DTE' });
        continue;
      }
      if (!(b.dte > a.dte)) {
        missing.add('non-increasing-dte');
        cells.push({ ...base, value: null, structural: false, reason: 'non-increasing DTE' });
        continue;
      }
      if (!validFwdIv(a.atmIv) || !validFwdIv(b.atmIv)) {
        missing.add('atm-leg-missing');
        cells.push({ ...base, value: null, structural: false, reason: 'ATM leg missing' });
        continue;
      }
      const fv = canonicalForwardVol(a.atmIv, a.T, b.atmIv, b.T);
      if (fv == null || fv < 0 || fv > 3) {
        missing.add(fv == null ? 'variance-invalid-negative' : 'forward-out-of-range');
        cells.push({ ...base, value: null, structural: false, reason: fv == null ? 'variance invalid/negative' : 'forward out of range' });
        continue;
      }
      validCount += 1;
      cells.push({ ...base, value: fv, structural: false, reason: null });
    }
  }
  const upperCount = (n * (n - 1)) / 2;
  const warnings = [
    'Forward volatility is derived from ATM IV legs via total variance; it is never an observed quote.',
    'Diagonal and lower-triangle cells are structurally blank, not data.',
    ...(capped ? [`Display cap: showing ${legs.length} of ${allLegs.length} expiries (latest truncated).`] : []),
  ];
  return {
    data: {
      symbol,
      spot,
      origin: { label: 'SPOT', note: 'SPOT is the current quote instant (underlying spot at snapshot time), never an expiry column.' },
      yearFraction: FWD_VOL_YEAR_FRACTION,
      formula: FWD_VOL_FORMULA,
      units: FWD_VOL_UNITS,
      ivBasis,
      expiries: legs,
      cells,
      computedCount: validCount,
      capped,
      totalLegs: allLegs.length,
    },
    coverage: {
      numerator: validCount,
      denominator: upperCount,
      missing: [...missing],
    },
    warnings,
  };
}

export function normalizedOptionRows(envelope) {
  if (Array.isArray(envelope?.data?.quotes)) {
    return envelope.data.quotes.map((quote) => ({
      instrument: null,
      expiry: quote.expiry,
      expiryTimeMs: Date.parse(`${quote.expiry}T20:00:00.000Z`),
      strike: quote.strike,
      right: quote.right,
      bidIv: null,
      askIv: null,
      venueMarkIv: quote.markIv,
      iv: quote.markIv,
      openInterest: quote.openInterest,
      contractSize: 100,
      inverse: false,
    }));
  }
  if (Array.isArray(envelope?.data?.instruments)) {
    return envelope.data.instruments
      .filter((row) => row.kind === 'option' && row.strike != null && row.right != null)
      .map((row) => ({
        instrument: row.instrument,
        expiry: expiryFromMs(row.expiryMs),
        expiryTimeMs: row.expiryMs,
        strike: row.strike,
        right: row.right,
        bidIv: row.bidIv,
        askIv: row.askIv,
        venueMarkIv: row.markIv,
        iv: row.markIv,
        openInterest: row.openInterest,
        contractSize: row.contractSize,
        inverse: row.isInverse,
      }))
      .filter((row) => row.expiry != null);
  }
  return [];
}

function boundedRows(envelope, requestedMaxRows) {
  const allRows = normalizedOptionRows(envelope);
  const numericLimit = Number(requestedMaxRows);
  const limit = Number.isInteger(numericLimit) && numericLimit > 0
    ? Math.min(numericLimit, HARD_MAX_ROWS)
    : DEFAULT_MAX_ROWS;
  return { rows: allRows.slice(0, limit), totalRows: allRows.length, limited: allRows.length > limit };
}

export function buildVolatilitySurface(envelope, symbol, options = {}) {
  const { rows, totalRows, limited } = boundedRows(envelope, options.maxRows);
  const observedNodes = rows.map((row) => ({
    expiry: row.expiry,
    strike: row.strike,
    right: row.right,
    bidIv: row.bidIv,
    askIv: row.askIv,
    venueMarkIv: row.venueMarkIv,
  }));
  const observedCount = observedNodes.filter((row) => row.bidIv != null || row.askIv != null || row.venueMarkIv != null).length;
  return {
    data: {
      symbol,
      spot: finite(envelope?.data?.spot ?? envelope?.data?.indexPrice),
      axes: { x: 'strike', y: 'expiry', z: 'decimal-volatility' },
      observedNodes,
      modelLayer: { status: 'unavailable', name: null, calibratedAt: null, nodes: [] },
      observedCount,
    },
    coverage: {
      numerator: observedCount,
      denominator: totalRows,
      missing: [...(observedCount < rows.length ? ['observed-iv'] : []), ...(limited ? ['row-limit'] : [])],
    },
    warnings: ['No model surface is calibrated at this boundary; observed holes remain holes.'],
  };
}

export function buildGreeks(envelope, symbol, modelInputs) {
  const { rows, totalRows, limited } = boundedRows(envelope, modelInputs?.maxRows);
  const spot = finite(envelope?.data?.spot ?? envelope?.data?.indexPrice);
  const asOfMs = Date.parse(envelope?.asOf ?? '');
  const inputs = {
    spot,
    asOfMs,
    riskFreeRate: finite(modelInputs?.riskFreeRate),
    carryRate: finite(modelInputs?.carryRate),
  };
  const points = rows.map((row) => {
    const greeks = modelGreeks(row, inputs);
    return {
      expiry: row.expiry,
      strike: row.strike,
      right: row.right,
      iv: row.iv,
      ivBasis: row.iv == null ? 'unavailable' : 'venue-mark',
      delta: greeks?.delta ?? null,
      gamma: greeks?.gamma ?? null,
      vega: greeks?.vega ?? null,
      theta: greeks?.theta ?? null,
      vanna: greeks?.vanna ?? null,
      charm: greeks?.charm ?? null,
    };
  });
  const computedCount = points.filter((row) => row.delta != null).length;
  const missing = [];
  if (spot == null) missing.push('spot');
  if (inputs.riskFreeRate == null) missing.push('riskFreeRate');
  if (inputs.carryRate == null) missing.push('carryRate');
  if (computedCount < rows.length) missing.push('greeks');
  if (limited) missing.push('row-limit');
  return {
    data: {
      symbol,
      spot,
      model: 'Black-Scholes-Merton',
      riskFreeRate: inputs.riskFreeRate,
      carryRate: inputs.carryRate,
      points,
      computedCount,
    },
    coverage: { numerator: computedCount, denominator: totalRows, missing },
    warnings: computedCount === 0
      ? ['Greeks are unavailable unless spot, venue mark IV, riskFreeRate, and carryRate are all supplied. No rates are defaulted.']
      : ['Greeks are model-derived from venue mark IV and explicit rate inputs; they are not observed venue Greeks.'],
  };
}

export function buildPositioning(envelope, symbol, modelInputs) {
  const { rows, totalRows, limited } = boundedRows(envelope, modelInputs?.maxRows);
  const greeks = buildGreeks(envelope, symbol, modelInputs);
  const spot = greeks.data.spot;
  const cryptoInverse = rows.some((row) => row.inverse);
  let overflowCount = 0;
  const points = rows.map((row, index) => {
    const greek = greeks.data.points[index];
    const oi = row.openInterest;
    const oiValid = typeof oi === 'number' && Number.isFinite(oi) && oi >= 0;
    const canScale = !cryptoInverse && spot != null && row.contractSize === 100
      && oiValid && greek?.delta != null && greek.gamma != null;
    const direction = row.right === 'call' ? 1 : -1;
    let raw;
    if (!canScale) {
      raw = { gex1PctUsd: null, dexUsd: null, vannaUsdPerUnitVol: null, charmUsdPerDay: null };
    } else if (oi === 0) {
      // Valid-zero short-circuit after canScale + per-Greek availability: avoids
      // Infinity * 0 = NaN when a huge-spot intermediate overflows before the
      // zero OI factor applies. Missing Greeks stay null, never forced to zero.
      raw = {
        gex1PctUsd: 0,
        dexUsd: 0,
        vannaUsdPerUnitVol: greek.vanna != null ? 0 : null,
        charmUsdPerDay: greek.charm != null ? 0 : null,
      };
    } else {
      raw = {
        gex1PctUsd: direction * greek.gamma * spot * spot * 0.01 * oi * 100,
        dexUsd: greek.delta * spot * oi * 100,
        vannaUsdPerUnitVol: greek.vanna != null ? greek.vanna * spot * oi * 100 : null,
        charmUsdPerDay: greek.charm != null ? greek.charm * spot * oi * 100 : null,
      };
    }
    const normalizedOi = oi == null ? null : (typeof oi === 'number' && !Number.isFinite(oi) ? null : oi);
    const out = {
      expiry: row.expiry,
      strike: row.strike,
      right: row.right,
      openInterest: normalizedOi,
      oiState: normalizedOi == null ? 'missing' : 'observed',
      gex1PctUsd: finite(raw.gex1PctUsd),
      dexUsd: finite(raw.dexUsd),
      vannaUsdPerUnitVol: finite(raw.vannaUsdPerUnitVol),
      charmUsdPerDay: finite(raw.charmUsdPerDay),
    };
    // Overflow = raw metric was requested (non-null) but not finite after finite().
    // Legitimately unavailable Greeks (raw null) never count as overflow, so a
    // missing Charm/Vanna does not suppress an otherwise valid finite row, and
    // computedCount (GEX-based) stays accurate while partial coverage is
    // disclosed via the overflow key. Finite metrics are preserved per metric.
    const overflowed = canScale && ['gex1PctUsd', 'dexUsd', 'vannaUsdPerUnitVol', 'charmUsdPerDay']
      .some((key) => raw[key] != null && out[key] == null);
    if (overflowed) overflowCount += 1;
    return out;
  });
  const computedCount = points.filter((row) => row.gex1PctUsd != null).length;
  const missing = [];
  if (points.some((row) => row.openInterest == null)) missing.push('openInterest');
  if (points.some((row) => typeof row.openInterest === 'number' && !(row.openInterest >= 0))) missing.push('invalid-open-interest');
  if (computedCount < rows.length) missing.push('positioning-proxy');
  if (overflowCount > 0) missing.push('non-finite-exposure-overflow');
  if (cryptoInverse) missing.push('inverse-contract-normalization');
  if (limited) missing.push('row-limit');
  const warnings = [
    'OI-weighted exposure uses an explicit mixed per-metric signed-Greek OI convention: GEX applies +gamma for calls and -gamma for puts; DEX/Vanna/Charm apply the signed model Greek with no right multiplier. It is not customer-long across all metrics and not observed dealer inventory.',
    ...(overflowCount > 0 ? [`${overflowCount} row(s) produced non-finite exposure in at least one metric; affected metrics are reported as null (unavailable) while other finite metrics on the same row are preserved.`] : []),
    ...(cryptoInverse ? ['Inverse crypto option exposure is unavailable until venue-native contract normalization is validated.'] : []),
  ];
  return {
    data: {
      symbol,
      spot,
      signModel: 'signed-greek-oi-proxy',
      contractMultiplier: cryptoInverse ? null : 100,
      points,
      computedCount,
    },
    coverage: { numerator: computedCount, denominator: totalRows, missing },
    warnings,
  };
}
