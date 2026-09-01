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
  const points = rows.map((row, index) => {
    const greek = greeks.data.points[index];
    const canScale = !cryptoInverse && spot != null && row.contractSize === 100
      && row.openInterest != null && greek?.delta != null && greek.gamma != null;
    const direction = row.right === 'call' ? 1 : -1;
    return {
      expiry: row.expiry,
      strike: row.strike,
      right: row.right,
      openInterest: row.openInterest,
      oiState: row.openInterest == null ? 'missing' : 'observed',
      gex1PctUsd: canScale ? direction * greek.gamma * spot * spot * 0.01 * row.openInterest * 100 : null,
      dexUsd: canScale ? greek.delta * spot * row.openInterest * 100 : null,
      vannaUsdPerUnitVol: canScale && greek.vanna != null ? greek.vanna * spot * row.openInterest * 100 : null,
      charmUsdPerDay: canScale && greek.charm != null ? greek.charm * spot * row.openInterest * 100 : null,
    };
  });
  const computedCount = points.filter((row) => row.gex1PctUsd != null).length;
  const missing = [];
  if (points.some((row) => row.openInterest == null)) missing.push('openInterest');
  if (computedCount < rows.length) missing.push('positioning-proxy');
  if (cryptoInverse) missing.push('inverse-contract-normalization');
  if (limited) missing.push('row-limit');
  return {
    data: {
      symbol,
      spot,
      signModel: 'customer-long-oi-proxy',
      contractMultiplier: cryptoInverse ? null : 100,
      points,
      computedCount,
    },
    coverage: { numerator: computedCount, denominator: totalRows, missing },
    warnings: [
      'OI-weighted exposure is an assumption-driven customer-long proxy, not observed dealer inventory.',
      ...(cryptoInverse ? ['Inverse crypto option exposure is unavailable until venue-native contract normalization is validated.'] : []),
    ],
  };
}
