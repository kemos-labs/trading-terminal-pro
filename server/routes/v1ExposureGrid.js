/**
 * Exposure-grid sub-resource (REF-03/04 API integration).
 *
 * POST /api/v1/analytics/positioning/exposure-grid
 *
 * Integrates the SAME accepted shared engine
 * (src/lib/options/exposureGrid.ts, bundled to
 * server/services/exposureGrid.bundle.js via
 * scripts/build-exposure-grid-bundle.mjs). No duplicated pricing formulas here:
 * this file only validates the request, binds canonical snapshot quotes to
 * engine inputs, and wraps the engine result in the canonical envelope.
 *
 * Expiry/model honesty (root finding):
 * - server/services/optionsAnalytics.js sets equity
 *   expiryTimeMs = Date.parse(expiry + 'T20:00:00.000Z'). That hardcoded
 *   20:00 instant is a model-time approximation, NOT a trustworthy verified
 *   settlement instant. This route NEVER uses it as observed exact expiry.
 * - Equity chain quotes (date-only expiry) bind expiryMs = null unless the
 *   caller supplies an explicit per-expiry scenario override instant, which is
 *   echoed in `data.scenario` and provenance-labelled `scenario-*`.
 * - Crypto instrument quotes bind the provider-supplied expiryMs instant as
 *   observed, but are priced under modelId 'futures-european', which the
 *   accepted engine reports as `unsupported-model` (no audited gamma/charm
 *   adapter) — typed partial, never silently substituted with spot-European.
 * - No default r/q/IV/multiplier/expiry. Raw provider IV is threaded as
 *   frozen `venue-mark` IV, distinct from any solved IV (which this route
 *   does not compute).
 *
 * Multiplier honesty (truth correction):
 * - The canonical equity snapshot carries NO per-contract multiplier field,
 *   so there is no verified equity multiplier to use — equity quotes bind
 *   multiplier null (engine `invalid-multiplier`) unless the caller supplies
 *   an explicit scenario multiplier. No silent 100 default is ever applied,
 *   and no adjusted-contract inference is attempted.
 * - Crypto `contractSize` is a verified venue-provided per-contract value and
 *   is honored when finite positive; the scenario multiplier only fills gaps.
 * - An explicit `scenario.multiplier` (bounded finite positive) is applied as
 *   a caller-supplied scenario assumption, provenance-labelled
 *   `scenario-multiplier` and echoed in `data.scenario`/`data.multiplierBasis`.
 *   It is never called observed.
 *
 * Instant honesty (truth correction):
 * - `times` entries and `scenario.expiryOverrides` values must be strict UTC
 *   ISO-8601 instants with a `Z` suffix (optional 1–3 digit fraction) or
 *   finite safe-integer epoch ms within the JS Date range. Date-only strings,
 *   timezone-less datetimes, numeric offsets, calendar rollovers (e.g. Feb 30
 *   rolling into March), NaN/Infinity and out-of-range epochs are rejected
 *   with typed 400s — never coerced via loose Date.parse.
 *
 * Truncation honesty (truth correction):
 * - Contract selection is the stable snapshot-order first-N (maxRows) over
 *   eligible rows. `data.rowSelection` reports total/eligible/used/omitted
 *   counts, the maxRows limit, and the truncation reason. Any truncation
 *   forces coverage to at most partial and is listed in coverage.missing.
 *   Upstream snapshot partial/missing coverage is merged in and never
 *   upgraded: a partial snapshot cannot yield a complete grid response.
 *   Grid cell counts are reported separately in `data.gridCells`.
 *
 * Scenario applicability (truth correction):
 * - `scenario.model` and `scenario.expiryOverrides` are equity-only. Supplying
 *   them against a crypto (instruments) snapshot is a typed 400
 *   (not applicable), never silently ignored while the echo implies they were
 *   chosen assumptions.
 * - A missing snapshot asOf stays null/unavailable end to end; no
 *   `snapshot-event-time` placeholder is fabricated.
 */
import { buildExposureGrid } from '../services/exposureGrid.bundle.js';

const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,11}$/;
const MAX_AXIS = 150;
const MAX_CELLS = 10_000;
const MAX_EPOCH_MS = 8_640_000_000_000_000;
const SCENARIO_MULT_MAX = 100_000;
const STRICT_UTC_INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?Z$/;
const EXPIRY_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function invalid(request, reply, sendError, message) {
  return sendError(request, reply, {
    statusCode: 400,
    code: 'INVALID_REQUEST',
    message,
    retryable: false,
  });
}

/**
 * Strict UTC-instant parser for the documented contract: a `Z`-suffixed
 * ISO-8601 UTC string (optional 1–3 digit fraction) with calendar round-trip
 * verification, or a finite safe-integer epoch ms > 0 within the JS Date
 * range. All-digit strings are accepted as epoch ms (transport coercion
 * tolerance — the runtime validator may deliver numbers as numeric strings).
 * Returns epoch ms or null. Rejects date-only strings, timezone-less
 * datetimes, numeric offsets, calendar rollover, NaN/Infinity, non-integers,
 * out-of-range epochs, and 8-digit all-numeric date-like strings (YYYYMMDD).
 */
export function strictInstantMs(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || !(value > 0) || value > MAX_EPOCH_MS) return null;
    return value;
  }
  if (typeof value !== 'string') return null;
  // M1: raw 8-digit numeric strings are date-like (YYYYMMDD), not epochs.
  // Genuine 8-digit epoch ms would be 1970-04-01; reject the ambiguous form.
  if (/^\d{8}$/.test(value)) return null;
  if (/^\d{1,16}$/.test(value)) {
    const epoch = Number(value);
    if (!Number.isSafeInteger(epoch) || !(epoch > 0) || epoch > MAX_EPOCH_MS) return null;
    return epoch;
  }
  const match = STRICT_UTC_INSTANT_RE.exec(value);
  if (!match) return null;
  const ms = Date.parse(value);
  if (!Number.isSafeInteger(ms) || !(ms > 0) || ms > MAX_EPOCH_MS) return null;
  const fraction = match[7] ?? '';
  const want = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`
    + `.${fraction ? `${fraction.slice(1)}000`.slice(0, 3) : '000'}Z`;
  if (new Date(ms).toISOString() !== want) return null;
  return ms;
}

function parseExpiryOverrideDate(value) {
  if (typeof value !== 'string') return null;
  const match = EXPIRY_DATE_RE.exec(value);
  if (!match) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

/** Verified per-contract multiplier only: finite number > 0, else null. Never defaulted here. */
function verifiedMultiplier(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) return candidate;
  }
  return null;
}

async function loadCanonicalOptions(fastify, symbol) {
  const path = symbol === 'BTC' || symbol === 'ETH'
    ? `/api/v1/market/crypto/${symbol}`
    : `/api/v1/market/options/${encodeURIComponent(symbol)}`;
  const response = await fastify.inject({ method: 'GET', url: path });
  return { statusCode: response.statusCode, body: response.json() };
}

export function registerV1ExposureGridRoutes(fastify, { sendContract, sendError, baseEnvelope, coverage } = {}) {
  fastify.post('/api/v1/analytics/positioning/exposure-grid', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['symbol', 'metric', 'prices', 'times'],
        properties: {
          symbol: { type: 'string', pattern: '^[A-Z][A-Z0-9.-]{0,11}$' },
          metric: { type: 'string', enum: ['gex', 'charm', 'dex'] },
          prices: { type: 'array', minItems: 2, maxItems: MAX_AXIS, items: { type: 'number' } },
          times: { type: 'array', minItems: 1, maxItems: MAX_AXIS, items: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
          maxRows: { type: 'integer', minimum: 1, maximum: 5_000 },
          scenario: {
            type: 'object',
            additionalProperties: false,
            properties: {
              riskFreeRate: { type: 'number', minimum: -0.25, maximum: 1 },
              carryRate: { type: 'number', minimum: -0.25, maximum: 1 },
              model: { type: 'string', enum: ['spot-european'] },
              multiplier: { type: 'number', exclusiveMinimum: 0, maximum: SCENARIO_MULT_MAX },
              expiryOverrides: {
                type: 'object',
                minProperties: 1,
                maxProperties: 60,
                additionalProperties: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const body = request.body ?? {};
    const symbol = String(body.symbol ?? '').toUpperCase();
    if (!SYMBOL_PATTERN.test(symbol)) {
      return invalid(request, reply, sendError, 'symbol must match ^[A-Z][A-Z0-9.-]{0,11}$.');
    }
    const metric = body.metric === 'gex' || body.metric === 'charm' || body.metric === 'dex' ? body.metric : null;
    if (metric == null) {
      return invalid(request, reply, sendError, "metric must be 'gex', 'charm' or 'dex'.");
    }
    // Strict axis validation BEFORE any expensive compute.
    if (!Array.isArray(body.prices) || body.prices.length < 2 || body.prices.length > MAX_AXIS) {
      return invalid(request, reply, sendError, `prices must be an array of 2..${MAX_AXIS} strictly increasing finite numbers > 0.`);
    }
    for (let i = 0; i < body.prices.length; i++) {
      const p = body.prices[i];
      if (typeof p !== 'number' || !Number.isFinite(p) || !(p > 0)) {
        return invalid(request, reply, sendError, `prices[${i}] must be a finite number > 0.`);
      }
      if (i > 0 && !(p > body.prices[i - 1])) {
        return invalid(request, reply, sendError, 'prices must be strictly increasing (no duplicates).');
      }
    }
    if (!Array.isArray(body.times) || body.times.length < 1 || body.times.length > MAX_AXIS) {
      return invalid(request, reply, sendError, `times must be an array of 1..${MAX_AXIS} strictly increasing UTC instants (strict Z-suffixed ISO-8601 or epoch ms).`);
    }
    const timesMs = [];
    for (let i = 0; i < body.times.length; i++) {
      const ms = strictInstantMs(body.times[i]);
      if (ms == null) {
        return invalid(request, reply, sendError, `times[${i}] must be a strict UTC ISO-8601 instant with Z suffix (optional 1–3 digit fraction, valid calendar date) or a finite safe-integer epoch ms in 1..${MAX_EPOCH_MS}; date-only strings, timezone-less datetimes, numeric offsets, and calendar rollovers are rejected.`);
      }
      if (i > 0 && !(ms > timesMs[i - 1])) {
        return invalid(request, reply, sendError, 'times must be strictly increasing (no duplicates).');
      }
      timesMs.push(ms);
    }
    const prices = [...body.prices];
    if (prices.length * timesMs.length > MAX_CELLS) {
      return invalid(request, reply, sendError, `prices × times exceeds the finite response bound (${MAX_CELLS} cells).`);
    }
    // Scenario validation: paired rates, explicit model only, bounded multiplier, bounded overrides.
    const scenarioIn = body.scenario ?? null;
    let scenarioRates = null;
    let scenarioModel = null;
    let scenarioMultiplier = null;
    let expiryOverrides = {};
    if (scenarioIn != null) {
      const hasR = scenarioIn.riskFreeRate != null;
      const hasQ = scenarioIn.carryRate != null;
      if (hasR !== hasQ) {
        return invalid(request, reply, sendError, 'scenario.riskFreeRate and scenario.carryRate must be supplied together; neither is silently defaulted.');
      }
      if (hasR) {
        const r = Number(scenarioIn.riskFreeRate);
        const q = Number(scenarioIn.carryRate);
        if (!Number.isFinite(r) || r < -0.25 || r > 1 || !Number.isFinite(q) || q < -0.25 || q > 1) {
          return invalid(request, reply, sendError, 'scenario rates must be finite decimals in [-0.25, 1].');
        }
        scenarioRates = { riskFreeRate: r, carryRate: q };
      }
      if (scenarioIn.model != null) {
        if (scenarioIn.model !== 'spot-european') {
          return invalid(request, reply, sendError, "scenario.model must be 'spot-european'; other exercise/settlement models are unavailable, never substituted.");
        }
        scenarioModel = 'spot-european';
      }
      if (scenarioIn.multiplier != null) {
        const m = Number(scenarioIn.multiplier);
        if (!Number.isFinite(m) || !(m > 0) || m > SCENARIO_MULT_MAX) {
          return invalid(request, reply, sendError, `scenario.multiplier must be a finite number in (0, ${SCENARIO_MULT_MAX}]; it is a caller-supplied scenario assumption, never an observed value.`);
        }
        scenarioMultiplier = m;
      }
      if (scenarioIn.expiryOverrides != null) {
        if (typeof scenarioIn.expiryOverrides !== 'object' || Array.isArray(scenarioIn.expiryOverrides)) {
          return invalid(request, reply, sendError, 'scenario.expiryOverrides must map YYYY-MM-DD expiry dates to explicit strict UTC instants.');
        }
        for (const [date, instant] of Object.entries(scenarioIn.expiryOverrides)) {
          if (parseExpiryOverrideDate(date) == null) {
            return invalid(request, reply, sendError, `scenario.expiryOverrides key '${date}' must be a valid YYYY-MM-DD expiry date (calendar rollovers rejected).`);
          }
          const ms = strictInstantMs(instant);
          if (ms == null) {
            return invalid(request, reply, sendError, `scenario.expiryOverrides['${date}'] must be a strict UTC ISO-8601 instant with Z suffix (valid calendar date) or finite safe-integer epoch ms; date-only strings, timezone-less datetimes, offsets, and calendar rollovers are rejected (no wall-clock default is assumed).`);
          }
          expiryOverrides[date] = ms;
        }
      }
    }
    const maxRows = body.maxRows == null ? 2_000 : body.maxRows;
    if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 5_000) {
      return invalid(request, reply, sendError, 'maxRows must be an integer in 1..5000.');
    }

    const upstream = await loadCanonicalOptions(fastify, symbol);
    if (upstream.statusCode !== 200) {
      return sendError(request, reply, {
        statusCode: upstream.statusCode >= 400 && upstream.statusCode < 500 ? upstream.statusCode : 502,
        code: upstream.body?.error?.code ?? 'PROVIDER_UNAVAILABLE',
        message: 'The canonical option snapshot required for exposure-grid analytics is unavailable.',
        retryable: upstream.statusCode >= 500,
      });
    }
    const snapshot = upstream.body;
    const snapshotSource = Array.isArray(snapshot.source) ? [...snapshot.source] : ['unknown'];
    // Missing snapshot asOf stays null/unavailable — never fabricated.
    const positionBasisAt = typeof snapshot.asOf === 'string' || typeof snapshot.asOf === 'number'
      ? snapshot.asOf
      : null;
    const snapshotAsOf = snapshot.asOf ?? null;
    const isCryptoSnapshot = Array.isArray(snapshot?.data?.instruments);

    // Scenario applicability: model + expiry overrides are equity-only. Against
    // a crypto snapshot they would be silently ignored while the echo implies
    // chosen assumptions — reject explicitly instead.
    if (isCryptoSnapshot && scenarioModel != null) {
      return invalid(request, reply, sendError, "scenario.model is not applicable to crypto futures-style option snapshots (engine reports unsupported-model; spot-european is never substituted) — remove scenario.model.");
    }
    if (isCryptoSnapshot && Object.keys(expiryOverrides).length > 0) {
      return invalid(request, reply, sendError, 'scenario.expiryOverrides is not applicable to crypto snapshots (crypto quotes already carry observed provider expiry instants) — remove scenario.expiryOverrides.');
    }

    // Bind canonical snapshot quotes → engine quotes over the FULL eligible
    // set, then apply the stable snapshot-order first-N (maxRows) selection.
    // Equity chain entries carry date-only expiries: expiryMs stays null
    // (missing-expiry) unless an explicit per-expiry scenario override instant
    // is supplied. The 20:00 UTC hardcode in
    // optionsAnalytics.normalizedOptionRows is deliberately NOT reused here —
    // it is not a verified settlement instant.
    // Equity snapshots carry no verified per-contract multiplier: multiplier
    // stays null (engine invalid-multiplier) unless an explicit scenario
    // multiplier is supplied. No 100 default is applied anywhere.
    const rawRows = Array.isArray(snapshot?.data?.quotes)
      ? snapshot.data.quotes
      : (Array.isArray(snapshot?.data?.instruments) ? snapshot.data.instruments : []);
    const totalContracts = rawRows.length;
    const eligibleRows = [];
    let ineligibleContracts = 0;
    for (const row of rawRows) {
      if (isCryptoSnapshot) {
        if (row?.kind === 'option'
          && (row.right === 'call' || row.right === 'put')
          && typeof row.strike === 'number' && Number.isFinite(row.strike) && row.strike > 0) {
          eligibleRows.push(row);
        } else {
          ineligibleContracts += 1;
        }
      } else if ((row?.right === 'call' || row?.right === 'put')
        && typeof row?.strike === 'number' && Number.isFinite(row.strike) && row.strike > 0) {
        eligibleRows.push(row);
      } else {
        ineligibleContracts += 1;
      }
    }
    const eligibleContracts = eligibleRows.length;
    const truncated = eligibleContracts > maxRows;
    const selectedRows = eligibleRows.slice(0, maxRows);
    const usedContracts = selectedRows.length;
    const omittedContracts = eligibleContracts - usedContracts;
    const truncationReason = truncated
      ? `eligible contract rows (${eligibleContracts}) exceed maxRows (${maxRows}); stable snapshot-order first-${maxRows} selection applied, ${omittedContracts} row(s) omitted`
      : null;

    const engineQuotes = [];
    let observedMultCount = 0;
    let scenarioMultCount = 0;
    let missingMultCount = 0;
    const scenarioUsed = scenarioRates != null || scenarioModel != null
      || Object.keys(expiryOverrides).length > 0 || scenarioMultiplier != null;
    if (!isCryptoSnapshot) {
      for (const quote of selectedRows) {
        const expiryDate = typeof quote.expiry === 'string' ? quote.expiry : null;
        const overrideMs = expiryDate != null ? expiryOverrides[expiryDate] : undefined;
        const verified = verifiedMultiplier(quote.contractSize, quote.multiplier);
        const applied = verified ?? scenarioMultiplier ?? null;
        if (verified != null) observedMultCount += 1;
        else if (scenarioMultiplier != null) scenarioMultCount += 1;
        else missingMultCount += 1;
        engineQuotes.push({
          type: quote.right,
          strike: quote.strike,
          expiryMs: overrideMs ?? null,
          settlement: overrideMs != null ? 'scenario-override (caller-supplied instant)' : undefined,
          modelId: scenarioModel ?? 'unspecified',
          openInterest: quote.openInterest ?? null,
          multiplier: applied,
          iv: typeof quote.markIv === 'number' && Number.isFinite(quote.markIv) && quote.markIv > 0 ? quote.markIv : null,
          ivProvenance: quote.markIv != null ? 'venue-mark' : 'unavailable',
          r: scenarioRates?.riskFreeRate ?? null,
          q: scenarioRates?.carryRate ?? null,
        });
      }
    } else {
      for (const row of selectedRows) {
        // Provider-supplied verified expiry instant (observed). Crypto
        // options are priced under futures-european, which the accepted
        // engine reports as unsupported-model — typed partial, never
        // substituted with spot-European.
        const verified = verifiedMultiplier(row.contractSize);
        const applied = verified ?? scenarioMultiplier ?? null;
        if (verified != null) observedMultCount += 1;
        else if (scenarioMultiplier != null) scenarioMultCount += 1;
        else missingMultCount += 1;
        engineQuotes.push({
          type: row.right,
          strike: row.strike,
          expiryMs: typeof row.expiryMs === 'number' && Number.isFinite(row.expiryMs) && row.expiryMs > 0 ? row.expiryMs : null,
          settlement: 'observed-provider-expiry-instant',
          modelId: 'futures-european',
          openInterest: row.openInterest ?? null,
          multiplier: applied,
          iv: typeof row.markIv === 'number' && Number.isFinite(row.markIv) && row.markIv > 0 ? row.markIv : null,
          ivProvenance: row.markIv != null ? 'venue-mark' : 'unavailable',
          r: scenarioRates?.riskFreeRate ?? null,
          q: scenarioRates?.carryRate ?? null,
        });
      }
    }

    let grid;
    try {
      grid = buildExposureGrid({
        quotes: engineQuotes,
        prices,
        timesMs,
        metric,
        positionBasisAt: positionBasisAt ?? 'unknown-snapshot-asof-unavailable',
        settlementRule: scenarioUsed
          ? 'scenario: explicit caller-supplied per-expiry instants and/or spot-european selection and/or scenario multiplier; no 16:00/20:00 ET default, no observed multiplier claimed'
          : 'observed provider expiry instants only; date-only equity expiries unavailable without explicit scenario override; no default multiplier',
      });
    } catch (error) {
      if (error instanceof RangeError) {
        return invalid(request, reply, sendError, `Exposure grid rejected: ${error.message}`);
      }
      throw error;
    }

    const flatCells = grid.cells.flat();
    const nonNullCells = flatCells.filter((cell) => cell.value != null).length;
    const totalCells = prices.length * timesMs.length;
    const gridCells = { computed: nonNullCells, total: totalCells };
    const rowSelection = {
      totalContracts,
      eligibleContracts,
      usedContracts,
      omittedContracts,
      ineligibleContracts,
      maxRows,
      truncated,
      selection: 'stable snapshot-order first-N eligible rows',
      truncationReason,
    };
    const multBits = [];
    if (observedMultCount > 0) multBits.push(`${observedMultCount} observed venue-provided per-contract multiplier(s)`);
    if (scenarioMultCount > 0) multBits.push(`${scenarioMultCount} scenario-multiplier (${scenarioMultiplier}, caller-supplied assumption, not observed)`);
    if (missingMultCount > 0) multBits.push(`${missingMultCount} unavailable (no verified or scenario multiplier; engine invalid-multiplier, never defaulted)`);
    const multiplierBasis = multBits.join('; ') || 'unavailable (no quotes bound)';
    const reasonMissing = [...new Set(flatCells.flatMap((cell) => cell.reasons))];
    const scenarioEcho = scenarioUsed
      ? {
        riskFreeRate: scenarioRates?.riskFreeRate ?? null,
        carryRate: scenarioRates?.carryRate ?? null,
        model: scenarioModel,
        multiplier: scenarioMultiplier,
        expiryOverrides: Object.fromEntries(
          Object.entries(expiryOverrides).map(([date, ms]) => [date, new Date(ms).toISOString()]),
        ),
      }
      : null;
    const quoteBasis = isCryptoSnapshot
      ? 'observed-snapshot'
      : (scenarioUsed ? 'observed-snapshot+scenario-overrides' : 'observed-snapshot');
    const staleSnapshot = snapshot.freshness === 'stale';
    // Coverage honesty: grid-cell completeness is reported on cells only;
    // truncation forces at most partial; upstream snapshot partial/missing
    // coverage is merged in and never upgraded to complete.
    const baseCoverage = coverage(nonNullCells, totalCells, [
      ...reasonMissing,
      ...(nonNullCells < totalCells ? ['grid-cells-unavailable'] : []),
      ...(engineQuotes.length === 0 ? ['no-quotes-bound'] : []),
      ...(ineligibleContracts > 0 ? ['ineligible-contract-rows-skipped'] : []),
    ]);
    const upstreamMissing = Array.isArray(snapshot.coverage?.missing) ? snapshot.coverage.missing : [];
    const upstreamState = snapshot.coverage?.state;
    const mergedMissing = [...new Set([
      ...baseCoverage.missing,
      ...upstreamMissing.map((m) => `snapshot-${m}`),
      ...(truncated ? [`truncated-${omittedContracts}-contract-rows-omitted (maxRows=${maxRows}; stable snapshot-order first-N selection)`] : []),
    ])];
    const rank = { unavailable: 0, partial: 1, complete: 2 };
    let coverageState = baseCoverage.state;
    if (truncated && coverageState === 'complete') coverageState = 'partial';
    if (upstreamState in rank && rank[coverageState] > rank[upstreamState]) coverageState = upstreamState;
    const finalCoverage = {
      numerator: baseCoverage.numerator,
      denominator: baseCoverage.denominator,
      state: coverageState,
      missing: mergedMissing,
    };
    const data = {
      symbol,
      metric: grid.metric,
      units: grid.units,
      prices: grid.prices,
      timesMs: grid.timesMs,
      cells: grid.cells,
      totals: grid.totals,
      methodology: grid.methodology,
      quoteBasis,
      scenario: scenarioEcho,
      rowSelection,
      gridCells,
      multiplierBasis,
      positionBasisAt,
      snapshotSource,
      ivBasis: 'sticky-frozen-venue-mark-per-quote (raw provider IV; no solved IV computed here)',
    };
    const envelope = baseEnvelope(request, {
      asOf: snapshotAsOf,
      fetchedAt: snapshot.fetchedAt,
      source: [...new Set([...snapshotSource, 'terminal-exposure-grid'])],
      freshness: staleSnapshot ? 'stale' : snapshot.freshness,
      coverage: finalCoverage,
      cache: snapshot.cache,
      provenanceByField: {
        'data.cells[].value': scenarioUsed
          ? 'derived-exposure-grid-shared-engine-scenario-inputs'
          : 'derived-exposure-grid-shared-engine-observed-snapshot',
        'data.prices': 'scenario-hypothetical-price-axis',
        'data.timesMs': 'scenario-hypothetical-valuation-axis',
        'data.positionBasisAt': 'observed-snapshot-event-time (frozen OI as-of, distinct from hypothetical time axis; null when snapshot asOf unavailable)',
        'data.snapshotSource': 'observed-canonical-snapshot-source',
        'data.scenario': scenarioUsed ? 'scenario-caller-supplied-overrides' : 'scenario-none',
        'data.rowSelection': 'route-contract-selection-counts (stable snapshot-order first-N)',
        'data.gridCells': 'route-grid-cell-completeness (separate from contract selection)',
        'data.multiplierBasis': scenarioMultCount > 0 && observedMultCount === 0
          ? 'scenario-caller-supplied-multiplier (not observed)'
          : observedMultCount > 0 && scenarioMultCount === 0
            ? 'observed-venue-provided-per-contract-multiplier'
            : 'mixed-or-unavailable-multiplier (see value)',
        'data.methodology': 'shared-engine-exposure-grid/v1 (bundled, no route-level pricing)',
      },
      unitsByField: {
        'data.prices': 'USD',
        'data.timesMs': 'epoch-ms-utc',
        'data.cells[].value': grid.units,
      },
      assumptions: [
        'Hypothetical price × time axes are scenarios, not observed future prices.',
        'Frozen OI at the snapshot event time; sticky frozen venue-mark IV per quote.',
        `Contract multipliers actually applied: ${multiplierBasis}. No 100 default is applied; missing multipliers are invalid-multiplier (null).`,
        scenarioUsed
          ? 'Scenario overrides applied (explicit rates/model/expiry instants/multiplier); results are scenario-labelled, not live observations.'
          : 'No scenario overrides: date-only equity expiries are unavailable (missing-expiry); crypto futures-style options are unsupported-model.',
      ],
      warnings: [...(snapshot.warnings ?? []), ...grid.warnings, ...(staleSnapshot ? ['canonical snapshot is stale; grid is computed on frozen stale inputs and stays stale'] : [])],
      data,
    });
    return sendContract(request, reply, 'exposureGridResponse', envelope);
  });
}
