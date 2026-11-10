/**
 * Linked positioning workbench (REF-01–04 core slice).
 *
 * POST /api/v1/analytics/positioning/workbench
 *
 * Returns the left strike profile plus the gamma, DEX delta-pressure, and
 * charm price×time grids
 * from ONE canonical snapshot bind (same snapshot frame identity for all
 * three). Reuses the SAME accepted shared engine
 * (server/services/exposureGrid.bundle.js); no pricing formulas here.
 * Binding policy mirrors v1ExposureGrid (verified multipliers only, explicit
 * scenario overrides, crypto unsupported-model) and imports its
 * strictInstantMs so instant truth (incl. M1 8-digit rejection) is shared.
 *
 * Reference strike profile: per-strike signed GEX evaluated at the snapshot
 * spot and the caller-selected reference instant, one engine call per strike
 * group (quotes filtered to that strike). Labelled OI-weighted exposure
 * proxy, never observed dealer inventory. Null per strike when unavailable;
 * zero only when the engine includes zero-OI quotes.
 */
import { buildExposureGrid } from '../services/exposureGrid.bundle.js';
import { strictInstantMs } from './v1ExposureGrid.js';

const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,11}$/;
const MAX_AXIS = 150;
const MAX_CELLS = 10_000;
const MAX_EPOCH_MS = 8_640_000_000_000_000;
const SCENARIO_MULT_MAX = 100_000;
const SERVICE_EVAL_BOUND = 250_000;
const CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const EXPIRY_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_PROFILE_STRIKES = 60;

function invalid(request, reply, sendError, message) {
  return sendError(request, reply, {
    statusCode: 400,
    code: 'INVALID_REQUEST',
    message,
    retryable: false,
  });
}

function parseExpiryOverrideDate(value) {
  if (typeof value !== 'string') return null;
  const match = EXPIRY_DATE_RE.exec(value);
  if (!match) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

const LINK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const LINK_KEYS = ['id', 'symbol', 'expiry', 'time', 'priceRange'];

// REF-02 T2: per-quote signed-GEX replication for the call/put split.
// The shared engine (exposureGrid.bundle.js) only returns the combined cell
// sum, so callGex/putGex are derived by summing per-quote signed GEX while
// walking the SAME already-selected engineQuotes group used for the single
// per-strike engine call below. This adds NO extra engine call per strike
// and does not widen the pre-evaluation budget (decision 5 counts stand).
// Gamma is the engine's verbatim side-independent closed form
// (greeksEuropean: dfQ * nd1 / (S * sigma * sqrtT)); sign (+call/-put) is
// applied by the caller exactly as the engine's gex branch does:
//   sign * gamma * S * S * 0.01 * openInterest * multiplier
// Guard-for-guard replication of the engine's exclusion reasons
// (missing-expiry, expired, unsupported-model, invalid-spot-strike,
// missing-iv, missing-rates, missing-oi, invalid-multiplier, zero-OI
// included as 0, non-finite fail-closed) so that
// callGex + putGex === engine cell value up to summation order (ulp).
const WB_MS_PER_YEAR = 365.25 * 24 * 3600 * 1e3;
const WB_SQRT_2PI = Math.sqrt(2 * Math.PI);
function wbNormPdf(x) {
  return Math.exp(-0.5 * x * x) / WB_SQRT_2PI;
}
function wbSpotGamma(S, K, T, r, q, vol) {
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * vol * vol) * T) / (vol * sqrtT);
  return Math.exp(-q * T) * wbNormPdf(d1) / (S * vol * sqrtT);
}
function wbFinite(n) {
  return typeof n === 'number' && Number.isFinite(n);
}
// Returns { included, contrib }: included=false mirrors an engine-excluded
// quote (missing/expired); included=true with contrib 0 is a valid zero-OI
// quote the engine counts as included.

function wbQuoteGex(q, S, t) {
  if (!wbFinite(q.expiryMs)) return { included: false, contrib: 0 };
  if (t >= q.expiryMs) return { included: false, contrib: 0 };
  if (q.modelId !== 'spot-european') return { included: false, contrib: 0 };
  if (!wbFinite(S) || !(S > 0) || !wbFinite(q.strike) || !(q.strike > 0)) return { included: false, contrib: 0 };
  if (!wbFinite(q.iv) || !(q.iv > 0)) return { included: false, contrib: 0 };
  if (!wbFinite(q.r) || !wbFinite(q.q)) return { included: false, contrib: 0 };
  if (q.openInterest == null) return { included: false, contrib: 0 };
  if (!wbFinite(q.openInterest) || q.openInterest < 0) return { included: false, contrib: 0 };
  if (!wbFinite(q.multiplier) || !(q.multiplier > 0)) return { included: false, contrib: 0 };
  if (q.openInterest === 0) return { included: true, contrib: 0 };
  const T = (q.expiryMs - t) / WB_MS_PER_YEAR;
  if (!wbFinite(T) || !(T > 0)) return { included: false, contrib: 0 };
  const gamma = wbSpotGamma(S, q.strike, T, q.r, q.q, q.iv);
  if (!wbFinite(gamma)) return { included: false, contrib: 0 };
  const sign = q.type === 'call' ? 1 : -1;
  const contrib = sign * gamma * S * S * 0.01 * q.openInterest * q.multiplier;
  if (!wbFinite(contrib)) return { included: false, contrib: 0 };
  return { included: true, contrib };
}

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

export function registerV1WorkbenchRoutes(fastify, { sendContract, sendError, baseEnvelope, coverage } = {}) {
  fastify.post('/api/v1/analytics/positioning/workbench', {
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['symbol', 'prices', 'times', 'referenceTime', 'scenario'],
        properties: {
          symbol: { type: 'string', pattern: '^[A-Z][A-Z0-9.-]{0,11}$' },
          prices: { type: 'array', minItems: 2, maxItems: MAX_AXIS, items: { type: 'number' } },
          times: { type: 'array', minItems: 1, maxItems: MAX_AXIS, items: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
          referenceTime: { anyOf: [{ type: 'string' }, { type: 'number' }] },
          expiryFilter: { type: 'string', maxLength: 10 },
          zeroDteOnly: { type: 'boolean' },
          maxRows: { type: 'integer', minimum: 1, maximum: 5_000 },
          calendar: {
            type: 'object',
            additionalProperties: false,
            required: ['dates'],
            properties: {
              dates: { type: 'array', minItems: 1, maxItems: MAX_AXIS, items: { type: 'string' } },
            },
          },
          // Optional linkGroup hint (REF-01 T1, gate B7): intentionally
          // untyped here so Ajv never coerces inner values; strict shape
          // (id pattern, boolean-only flags, no unknown keys) is enforced
          // manually below with typed 400s — no silent normalization.
          linkGroup: { type: 'object' },
          // Optional profileUnits hint (REF-02 T2, gate B8): client-side
          // presentation echo only (contracts vs gex over the same frame).
          // Plain string, never validated into a 400 — the server always
          // computes both unit legs; the toggle never refetches.
          profileUnits: { type: 'string', maxLength: 32 },
          scenario: {
            type: 'object',
            additionalProperties: false,
            required: ['riskFreeRate', 'carryRate', 'model', 'multiplier'],
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
      return invalid(request, reply, sendError, `times must be an array of 1..${MAX_AXIS} strictly increasing UTC instants.`);
    }
    const timesMs = [];
    for (let i = 0; i < body.times.length; i++) {
      const ms = strictInstantMs(body.times[i]);
      if (ms == null) {
        return invalid(request, reply, sendError, `times[${i}] must be a strict UTC ISO-8601 instant with Z suffix (valid calendar date) or a finite safe-integer epoch ms; date-only strings, 8-digit date-like numerics, timezone-less datetimes, offsets, and rollovers are rejected.`);
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
    const referenceMs = strictInstantMs(body.referenceTime);
    if (referenceMs == null) {
      return invalid(request, reply, sendError, 'referenceTime must be a strict UTC instant (same truth as times); no wall-clock default is assumed.');
    }
    if (!timesMs.includes(referenceMs)) {
      return invalid(request, reply, sendError, 'referenceTime must equal one of the times axis instants so the strike profile shares the grid frame.');
    }
    // Optional calendar block (REF-05): calendar dates map to the reference
    // instant's UTC clock. Decision 3: every YYYY-MM-DD maps to the explicit
    // reference instant's HH:MM:SS.mmm — no hardcoded 20:00, no
    // index-to-days mapping. First date must equal the reference UTC date so
    // the first column instant equals the reference instant exactly.
    let calendarDates = null;
    if (body.calendar != null) {
      const rawDates = body.calendar.dates;
      if (!Array.isArray(rawDates) || rawDates.length < 1 || rawDates.length > MAX_AXIS) {
        return invalid(request, reply, sendError, `calendar.dates must be an array of 1..${MAX_AXIS} YYYY-MM-DD calendar dates.`);
      }
      const seen = new Set();
      calendarDates = [];
      for (let i = 0; i < rawDates.length; i++) {
        const d = rawDates[i];
        if (typeof d !== 'string' || !CALENDAR_DATE_RE.test(d)) {
          return invalid(request, reply, sendError, `calendar.dates[${i}] must be a valid YYYY-MM-DD calendar date.`);
        }
        const probe = new Date(`${d}T00:00:00.000Z`);
        if (!Number.isFinite(probe.getTime()) || probe.toISOString().slice(0, 10) !== d) {
          return invalid(request, reply, sendError, `calendar.dates[${i}] '${d}' is not a real calendar date (rollovers rejected).`);
        }
        if (seen.has(d)) {
          return invalid(request, reply, sendError, `calendar.dates[${i}] '${d}' is a duplicate; dates must be unique and strictly increasing.`);
        }
        seen.add(d);
        if (i > 0 && !(d > calendarDates[i - 1])) {
          return invalid(request, reply, sendError, 'calendar.dates must be strictly increasing (no duplicates, no reordering).');
        }
        calendarDates.push(d);
      }
      const refDate = new Date(referenceMs).toISOString().slice(0, 10);
      if (calendarDates[0] !== refDate) {
        return invalid(request, reply, sendError, `calendar.dates[0] '${calendarDates[0]}' must equal the reference instant's UTC date '${refDate}' so the first column instant equals the reference instant exactly.`);
      }
    }
    // Optional linkGroup block (REF-01 T1, gate B7): UI-state linkage hint.
    // Validated and echoed verbatim; the server never mutates panel state.
    // Absent = unlinked. Empty object = group present but nothing linked.
    // No silent normalization: non-boolean flags and bad ids are 400.
    let linkGroup = null;
    if (body.linkGroup != null) {
      if (typeof body.linkGroup !== 'object' || Array.isArray(body.linkGroup)) {
        return invalid(request, reply, sendError, 'linkGroup must be an object with optional id, symbol, expiry, time, priceRange.');
      }
      for (const key of Object.keys(body.linkGroup)) {
        if (!LINK_KEYS.includes(key)) {
          return invalid(request, reply, sendError, `linkGroup must not contain unknown linkage keys; allowed: ${LINK_KEYS.join(', ')}.`);
        }
      }
      if (body.linkGroup.id != null) {
        if (typeof body.linkGroup.id !== 'string' || !LINK_ID_RE.test(body.linkGroup.id)) {
          return invalid(request, reply, sendError, 'linkGroup.id must match ^[A-Za-z0-9_-]{1,64}$ (broken-link-isolated: no panel state mutated).');
        }
      }
      for (const flag of ['symbol', 'expiry', 'time', 'priceRange']) {
        if (body.linkGroup[flag] != null && typeof body.linkGroup[flag] !== 'boolean') {
          return invalid(request, reply, sendError, `linkGroup.${flag} must be a boolean when present; no silent normalization is applied.`);
        }
      }
      linkGroup = {};
      if (body.linkGroup.id != null) linkGroup.id = body.linkGroup.id;
      for (const flag of ['symbol', 'expiry', 'time', 'priceRange']) {
        if (body.linkGroup[flag] != null) linkGroup[flag] = body.linkGroup[flag];
      }
    }
    // Scenario is REQUIRED here (no silent defaults): explicit r/q/model/multiplier.
    const sc = body.scenario ?? {};
    const r = Number(sc.riskFreeRate);
    const q = Number(sc.carryRate);
    if (!Number.isFinite(r) || r < -0.25 || r > 1 || !Number.isFinite(q) || q < -0.25 || q > 1) {
      return invalid(request, reply, sendError, 'scenario.riskFreeRate and scenario.carryRate are required as finite decimals in [-0.25, 1]; nothing is prefilled as observed.');
    }
    if (sc.model !== 'spot-european') {
      return invalid(request, reply, sendError, "scenario.model must be 'spot-european'; futures remains unsupported, never substituted.");
    }
    const scenarioMultiplier = Number(sc.multiplier);
    if (!Number.isFinite(scenarioMultiplier) || !(scenarioMultiplier > 0) || scenarioMultiplier > SCENARIO_MULT_MAX) {
      return invalid(request, reply, sendError, 'scenario.multiplier is required as a caller-supplied assumption; it is never an observed value.');
    }
    let expiryOverrides = {};
    if (sc.expiryOverrides != null) {
      if (typeof sc.expiryOverrides !== 'object' || Array.isArray(sc.expiryOverrides)) {
        return invalid(request, reply, sendError, 'scenario.expiryOverrides must map YYYY-MM-DD expiry dates to explicit strict UTC instants.');
      }
      for (const [date, instant] of Object.entries(sc.expiryOverrides)) {
        if (parseExpiryOverrideDate(date) == null) {
          return invalid(request, reply, sendError, `scenario.expiryOverrides key '${date}' must be a valid YYYY-MM-DD expiry date.`);
        }
        const ms = strictInstantMs(instant);
        if (ms == null) {
          return invalid(request, reply, sendError, `scenario.expiryOverrides['${date}'] must be a strict UTC instant (no wall-clock default is assumed).`);
        }
        expiryOverrides[date] = ms;
      }
    }
    const maxRows = body.maxRows == null ? 2_000 : body.maxRows;
    if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 5_000) {
      return invalid(request, reply, sendError, 'maxRows must be an integer in 1..5000.');
    }
    const expiryFilter = typeof body.expiryFilter === 'string' && body.expiryFilter.length > 0 ? body.expiryFilter : null;
    const zeroDteOnly = body.zeroDteOnly === true;

    const upstream = await loadCanonicalOptions(fastify, symbol);
    if (upstream.statusCode !== 200) {
      return sendError(request, reply, {
        statusCode: upstream.statusCode >= 400 && upstream.statusCode < 500 ? upstream.statusCode : 502,
        code: upstream.body?.error?.code ?? 'PROVIDER_UNAVAILABLE',
        message: 'The canonical option snapshot required for the positioning workbench is unavailable.',
        retryable: upstream.statusCode >= 500,
      });
    }
    const snapshot = upstream.body;
    const snapshotSource = Array.isArray(snapshot.source) ? [...snapshot.source] : ['unknown'];
    const positionBasisAt = typeof snapshot.asOf === 'string' || typeof snapshot.asOf === 'number' ? snapshot.asOf : null;
    const snapshotAsOf = snapshot.asOf ?? null;
    const isCryptoSnapshot = Array.isArray(snapshot?.data?.instruments);
    if (isCryptoSnapshot) {
      return invalid(request, reply, sendError, 'Workbench scenario model spot-european is not applicable to crypto futures-style snapshots (unsupported-model); crypto workbench is Unavailable, never substituted.');
    }
    const spotRef = typeof snapshot?.data?.spot === 'number' && Number.isFinite(snapshot.data.spot) && snapshot.data.spot > 0
      ? snapshot.data.spot
      : null;

    const rawRows = Array.isArray(snapshot?.data?.quotes) ? snapshot.data.quotes : [];
    const totalContracts = rawRows.length;
    const eligibleRows = [];
    let ineligibleContracts = 0;
    for (const row of rawRows) {
      if ((row?.right === 'call' || row?.right === 'put')
        && typeof row?.strike === 'number' && Number.isFinite(row.strike) && row.strike > 0
        && (expiryFilter == null || row.expiry === expiryFilter)
        && (!zeroDteOnly || row.expiry === snapshot?.data?.expirations?.[0])) {
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

    // ONE bind: engine quotes shared by gex grid, charm grid, and profile.
    const engineQuotes = [];
    for (const quote of selectedRows) {
      const expiryDate = typeof quote.expiry === 'string' ? quote.expiry : null;
      const overrideMs = expiryDate != null ? expiryOverrides[expiryDate] : undefined;
      const verified = verifiedMultiplier(quote.contractSize, quote.multiplier);
      engineQuotes.push({
        type: quote.right,
        strike: quote.strike,
        expiryMs: overrideMs ?? null,
        settlement: overrideMs != null ? 'scenario-override (caller-supplied instant)' : undefined,
        modelId: 'spot-european',
        openInterest: quote.openInterest ?? null,
        multiplier: verified ?? scenarioMultiplier,
        iv: typeof quote.markIv === 'number' && Number.isFinite(quote.markIv) && quote.markIv > 0 ? quote.markIv : null,
        ivProvenance: quote.markIv != null ? 'venue-mark' : 'unavailable',
        r,
        q,
      });
    }
    const frameId = `${symbol}|${String(positionBasisAt ?? 'no-asof')}|n=${engineQuotes.length}|ref=${referenceMs}`;
    const settlementRule = 'scenario: explicit caller-supplied r/q, spot-european, multiplier, and per-expiry instants; no 16:00/20:00 ET default, no observed multiplier claimed';

    // Calendar instants from the reference clock (decision 3): the explicit
    // reference instant supplies HH:MM:SS.mmm for every calendar column.
    let calendarInstantsMs = null;
    let calendarClock = null;
    if (calendarDates != null) {
      calendarClock = new Date(referenceMs).toISOString().slice(11, 23);
      calendarInstantsMs = [];
      for (let i = 0; i < calendarDates.length; i++) {
        const ms = Date.parse(`${calendarDates[i]}T${calendarClock}Z`);
        if (!Number.isSafeInteger(ms) || !(ms > 0)) {
          return invalid(request, reply, sendError, `calendar.dates[${i}] '${calendarDates[i]}' cannot be mapped to the reference clock '${calendarClock}' (invalid instant).`);
        }
        if (new Date(ms).toISOString().slice(0, 10) !== calendarDates[i]) {
          return invalid(request, reply, sendError, `calendar.dates[${i}] '${calendarDates[i]}' rolled under the reference clock (invalid/rolled date).`);
        }
        if (i > 0 && !(ms > calendarInstantsMs[i - 1])) {
          return invalid(request, reply, sendError, 'calendar dates must map to strictly increasing instants under the reference clock.');
        }
        calendarInstantsMs.push(ms);
      }
      if (calendarInstantsMs[0] !== referenceMs) {
        return invalid(request, reply, sendError, 'calendar first-column instant must equal the reference instant exactly.');
      }
      if (prices.length * calendarInstantsMs.length > MAX_CELLS) {
        return invalid(request, reply, sendError, `calendar prices × dates exceeds the finite response bound (${MAX_CELLS} cells); reduce resolution explicitly.`);
      }
    }

    // Decision 5: pre-evaluation total budget across every requested engine
    // call — gex grid, dex grid, charm grid, strike profile groups, exact-spot
    // summary, and calendar surface — using the effective bound quote count.
    // No evaluation happens before this bound is accepted.
    const effQ = engineQuotes.length;
    const profileStrikes = [...new Set(selectedRows.map((row) => row.strike))].sort((a, b) => a - b).slice(0, MAX_PROFILE_STRIKES);
    const profileEvals = profileStrikes.reduce((acc, strike) => acc + selectedRows.filter((row) => row.strike === strike).length, 0);
    const exactSpotEvals = 1 * 1 * effQ;
    const calendarEvals = calendarInstantsMs != null ? prices.length * calendarInstantsMs.length * effQ : 0;
    const totalEvals = prices.length * timesMs.length * effQ
      + prices.length * timesMs.length * effQ
      + prices.length * timesMs.length * effQ
      + profileEvals + exactSpotEvals + calendarEvals;
    const budget = {
      perCallCells: MAX_CELLS,
      serviceBound: SERVICE_EVAL_BOUND,
      effectiveQuotes: effQ,
      gex: prices.length * timesMs.length * effQ,
      dex: prices.length * timesMs.length * effQ,
      charm: prices.length * timesMs.length * effQ,
      profile: profileEvals,
      exactSpot: exactSpotEvals,
      calendar: calendarEvals,
      total: totalEvals,
    };
    if (totalEvals > SERVICE_EVAL_BOUND) {
      return invalid(request, reply, sendError, `Workbench total evaluation budget exceeded: ${totalEvals} > ${SERVICE_EVAL_BOUND} engine evaluations (gex ${budget.gex} + dex ${budget.dex} + charm ${budget.charm} + profile ${profileEvals} + exact-spot ${exactSpotEvals} + calendar ${calendarEvals} at ${effQ} bound quotes). Reduce prices × times × dates resolution or maxRows explicitly; the selected horizon and null/expiry policy are retained.`);
    }

    let gex;
    let dex;
    let charm;
    try {
      const common = {
        quotes: engineQuotes, prices, timesMs,
        positionBasisAt: positionBasisAt ?? 'unknown-snapshot-asof-unavailable',
        settlementRule,
      };
      gex = buildExposureGrid({ ...common, metric: 'gex' });
      dex = buildExposureGrid({ ...common, metric: 'dex' });
      charm = buildExposureGrid({ ...common, metric: 'charm' });
    } catch (error) {
      if (error instanceof RangeError) {
        return invalid(request, reply, sendError, `Workbench grid rejected: ${error.message}`);
      }
      throw error;
    }

    // Decision 4: exact-spot current exposure from the SAME quote set at
    // exactly the canonical spot and reference instant — never a
    // nearest-node or interpolated replacement under the current label.
    let exactSpot = { value: null, reasons: spotRef == null ? ['missing-spot'] : [] };
    if (spotRef != null && effQ > 0) {
      try {
        const one = buildExposureGrid({
          quotes: engineQuotes, prices: [spotRef], timesMs: [referenceMs], metric: 'gex',
          positionBasisAt: positionBasisAt ?? 'unknown-snapshot-asof-unavailable',
          settlementRule,
        });
        const cell = one.cells[0]?.[0];
        exactSpot = { value: cell?.value ?? null, reasons: cell?.reasons ?? [] };
      } catch {
        exactSpot = { value: null, reasons: ['evaluation-failed'] };
      }
    } else if (spotRef != null && effQ === 0) {
      exactSpot = { value: null, reasons: ['no-quotes-bound'] };
    }

    // REF-05 calendar surface: signed gamma (gex convention) over the
    // explicit percentage-price range × calendar dates, same quote set.
    // No interpolation through missing/expired cells; expired contributions
    // are excluded per-cell by the shared engine (t >= expiryMs).
    let calendar = null;
    if (calendarInstantsMs != null) {
      let calGrid;
      try {
        calGrid = buildExposureGrid({
          quotes: engineQuotes, prices, timesMs: calendarInstantsMs, metric: 'gex',
          positionBasisAt: positionBasisAt ?? 'unknown-snapshot-asof-unavailable',
          settlementRule,
        });
      } catch (error) {
        if (error instanceof RangeError) {
          return invalid(request, reply, sendError, `Workbench calendar rejected: ${error.message}`);
        }
        throw error;
      }
      let lo = null;
      let hi = null;
      let peak = null;
      for (let pi = 0; pi < prices.length; pi++) {
        for (let di = 0; di < calendarInstantsMs.length; di++) {
          const v = calGrid.cells[pi]?.[di]?.value;
          if (v == null || !Number.isFinite(v)) continue;
          if (lo == null || v < lo) lo = v;
          if (hi == null || v > hi) hi = v;
          const abs = Math.abs(v);
          const peakAbs = peak == null ? -1 : Math.abs(peak.value);
          if (abs > peakAbs
            || (abs === peakAbs && peak != null
              && (calendarInstantsMs[di] < peak.instantMs
                || (calendarInstantsMs[di] === peak.instantMs && prices[pi] < peak.price)))) {
            peak = {
              value: v,
              price: prices[pi],
              date: calendarDates[di],
              instantMs: calendarInstantsMs[di],
              instant: new Date(calendarInstantsMs[di]).toISOString(),
            };
          }
        }
      }
      calendar = {
        dates: [...calendarDates],
        instantsMs: [...calendarInstantsMs],
        instants: calendarInstantsMs.map((ms) => new Date(ms).toISOString()),
        clock: calendarClock,
        prices: [...prices],
        cells: calGrid.cells,
        current: {
          spot: spotRef,
          instantMs: referenceMs,
          instant: new Date(referenceMs).toISOString(),
          value: exactSpot.value,
          unit: '$/1% move',
          reasons: exactSpot.reasons,
        },
        peak,
        domain: { min: lo, max: hi, symmetricAuto: false },
        colorSemantics: 'stable: positive = long-gamma exposure, negative = short-gamma exposure; zero contour where finite neighbors change sign; missing/expired cells are null (hatched), never zero-filled or interpolated',
        snapshotIdentity: frameId,
        budget,
      };
    }

    // Reference strike profile at (spotRef, referenceMs), per strike group.
    // Strike list was fixed pre-evaluation for the total budget (decision 5).
    // REF-02 T2 (gate B8/B10): each row keeps `value` as the combined signed
    // GEX (backward compatible) and gains additive nullable splits pinned to
    // the existing signed OI proxy — contractsCall=+callOI,
    // contractsPut=-putOI, contracts=call+put; callGex+putGex=value (ulp).
    // Missing rows stay null (never zero-filled); a valid zero stays 0;
    // an absent side of a computed row is numeric 0, not null.
    let profile = [];
    let profileBasis = 'unavailable: no live spot reference in snapshot';
    if (spotRef != null) {
      const kept = profileStrikes;
      for (const strike of kept) {
        const group = engineQuotes.filter((qq) => qq.strike === strike);
        let value = null;
        try {
          const one = buildExposureGrid({
            quotes: group, prices: [spotRef], timesMs: [referenceMs], metric: 'gex',
            positionBasisAt: positionBasisAt ?? 'unknown-snapshot-asof-unavailable',
            settlementRule,
          });
          value = one.cells[0]?.[0]?.value ?? null;
        } catch {
          value = null;
        }
        let contracts = null;
        let contractsCall = null;
        let contractsPut = null;
        let callGex = null;
        let putGex = null;
        if (value != null && Number.isFinite(value)) {
          let cCall = 0;
          let cPut = 0;
          let gCall = 0;
          let gPut = 0;
          let oiSeen = false;
          for (const qq of group) {
            if (wbFinite(qq.openInterest) && qq.openInterest >= 0) {
              oiSeen = true;
              if (qq.type === 'call') cCall += qq.openInterest;
              else if (qq.type === 'put') cPut += qq.openInterest;
            }
            const split = wbQuoteGex(qq, spotRef, referenceMs);
            if (split.included) {
              if (qq.type === 'call') gCall += split.contrib;
              else if (qq.type === 'put') gPut += split.contrib;
            }
          }
          // value finite implies >=1 engine-included quote with valid OI;
          // the oiSeen guard keeps the row null (never zero-filled) if not.
          if (oiSeen && wbFinite(gCall) && wbFinite(gPut)) {
            contractsCall = cCall;
            contractsPut = -cPut;
            contracts = cCall - cPut;
            callGex = gCall;
            putGex = gPut;
          }
        }
        profile.push({ strike, value, unit: '$/1% move', basis: 'OI-weighted exposure proxy (not observed dealer inventory)', contracts, contractsCall, contractsPut, callGex, putGex });
      }
      profileBasis = `per-strike signed GEX at spot ${spotRef} and reference instant ${new Date(referenceMs).toISOString()} (same snapshot frame)`;
      if ([...new Set(selectedRows.map((row) => row.strike))].length > kept.length) profileBasis += `; first-${kept.length} strikes shown`;
    }

    const gexFlat = gex.cells.flat();
    const dexFlat = dex.cells.flat();
    const charmFlat = charm.cells.flat();
    const gexComputed = gexFlat.filter((cell) => cell.value != null).length;
    const dexComputed = dexFlat.filter((cell) => cell.value != null).length;
    const charmComputed = charmFlat.filter((cell) => cell.value != null).length;
    const cellTotal = prices.length * timesMs.length;
    const rowSelection = {
      totalContracts, eligibleContracts, usedContracts, omittedContracts, ineligibleContracts,
      maxRows, truncated, selection: 'stable snapshot-order first-N eligible rows',
      truncationReason: truncated ? `eligible contract rows (${eligibleContracts}) exceed maxRows (${maxRows})` : null,
    };
    const scenarioEcho = {
      riskFreeRate: r, carryRate: q, model: 'spot-european', multiplier: scenarioMultiplier,
      expiryOverrides: Object.fromEntries(Object.entries(expiryOverrides).map(([date, ms]) => [date, new Date(ms).toISOString()])),
    };
    const asofLabel = positionBasisAt ?? 'unknown-snapshot-asof-unavailable';
    const gridData = (grid, computed) => ({
      symbol, metric: grid.metric, units: grid.units, prices: grid.prices, timesMs: grid.timesMs,
      cells: grid.cells, totals: grid.totals, methodology: grid.methodology,
      quoteBasis: 'observed-snapshot+scenario-overrides', scenario: scenarioEcho,
      rowSelection, gridCells: { computed, total: cellTotal },
      multiplierBasis: `${scenarioMultiplier} scenario-multiplier (caller-supplied assumption, not observed)`,
      positionBasisAt: asofLabel,
      snapshotSource, ivBasis: 'sticky-frozen-venue-mark-per-quote (raw provider IV; no solved IV computed here)',
    });
    const flatCells = [...gexFlat, ...dexFlat, ...charmFlat];
    const calendarReasons = calendar != null ? [...new Set(calendar.cells.flat().flatMap((cell) => cell.reasons))].map((r) => `calendar-${r}`) : [];
    const nonNullCells = gexComputed + dexComputed + charmComputed;
    const totalCells = 3 * cellTotal;
    const reasonMissing = [...new Set(flatCells.flatMap((cell) => cell.reasons))];
    const baseCoverage = coverage(nonNullCells, totalCells, [
      ...reasonMissing,
      ...(nonNullCells < totalCells ? ['grid-cells-unavailable'] : []),
      ...(engineQuotes.length === 0 ? ['no-quotes-bound'] : []),
      ...(ineligibleContracts > 0 ? ['ineligible-contract-rows-skipped'] : []),
      ...(spotRef == null ? ['no-spot-reference-profile-unavailable'] : []),
    ]);
    const upstreamMissing = Array.isArray(snapshot.coverage?.missing) ? snapshot.coverage.missing : [];
    const upstreamState = snapshot.coverage?.state;
    const mergedMissing = [...new Set([
      ...baseCoverage.missing,
      ...calendarReasons,
      ...(calendar != null && calendar.cells.flat().some((c) => c.value == null) ? ['calendar-cells-unavailable'] : []),
      ...upstreamMissing.map((m) => `snapshot-${m}`),
      ...(truncated ? [`truncated-${omittedContracts}-contract-rows-omitted (maxRows=${maxRows})`] : []),
    ])];
    const rank = { unavailable: 0, partial: 1, complete: 2 };
    let coverageState = baseCoverage.state;
    if (truncated && coverageState === 'complete') coverageState = 'partial';
    if (upstreamState in rank && rank[coverageState] > rank[upstreamState]) coverageState = upstreamState;
    const staleSnapshot = snapshot.freshness === 'stale';
    // REF-02 T2 (gate B8): profileUnits is a client-side presentation echo
    // only — it never changes the frame, the cache key, or the computation.
    const profileUnitsEcho = typeof body.profileUnits === 'string' ? body.profileUnits : null;
    const data = {
      symbol,
      frameId,
      referenceTimeMs: referenceMs,
      spotRef,
      gex: gridData(gex, gexComputed),
      dex: gridData(dex, dexComputed),
      charm: gridData(charm, charmComputed),
      profile,
      profileBasis,
      ...(profileUnitsEcho != null ? { profileUnits: profileUnitsEcho } : {}),
      quoteBasis: 'observed-snapshot+scenario-overrides',
      scenario: { ...scenarioEcho, expiryFilter, zeroDteOnly },
      rowSelection,
      gridCells: { computed: nonNullCells, total: totalCells },
      multiplierBasis: `${scenarioMultiplier} scenario-multiplier (caller-supplied assumption, not observed)`,
      positionBasisAt: positionBasisAt ?? 'unknown-snapshot-asof-unavailable',
      snapshotSource,
      ivBasis: 'sticky-frozen-venue-mark-per-quote (raw provider IV; no solved IV computed here)',
      calendar,
      linkGroup,
    };
    const envelope = baseEnvelope(request, {
      asOf: snapshotAsOf,
      fetchedAt: snapshot.fetchedAt,
      source: [...new Set([...snapshotSource, 'terminal-positioning-workbench'])],
      freshness: staleSnapshot ? 'stale' : snapshot.freshness,
      coverage: { numerator: baseCoverage.numerator, denominator: baseCoverage.denominator, state: coverageState, missing: mergedMissing },
      cache: snapshot.cache,
      provenanceByField: {
        'data.gex.cells[].value': 'derived-exposure-grid-shared-engine-scenario-inputs (same frame)',
        'data.dex.cells[].value': 'derived-exposure-grid-shared-engine-scenario-inputs (same frame, signed kernel delta × S × OI × mult; no side negation)',
        'data.charm.cells[].value': 'derived-exposure-grid-shared-engine-scenario-inputs (same frame)',
        'data.profile[].value': 'derived-exposure-grid-shared-engine-scenario-inputs (same frame, spot × reference instant)',
        'data.profile[].contracts': 'derived-signed-OI-sum-per-strike (same frame; +callOI − putOI convention; not observed dealer inventory)',
        'data.profile[].callGex': 'derived-exposure-grid-shared-engine-scenario-inputs (same frame, per-quote signed-GEX call-side sum; call + put = net)',
        'data.profile[].putGex': 'derived-exposure-grid-shared-engine-scenario-inputs (same frame, per-quote signed-GEX put-side sum; call + put = net)',
        'data.profileUnits': 'ui-presentation-hint-echo (contracts vs gex over the same frame; never a recompute selector)',
        'data.calendar.cells[].value': 'derived-exposure-grid-shared-engine-calendar (same frame; calendar date × hypothetical price, reference-clock instants)',
        'data.calendar.current.value': 'derived-exposure-grid exact-spot current exposure (same quote set, canonical spot × reference instant; no nearest-node substitution)',
        'data.calendar.peak': 'resolution-dependent grid-node peak (max absolute finite value; ties earliest instant then lowest price)',
        'data.prices': 'scenario-hypothetical-price-axis',
        'data.timesMs': 'scenario-hypothetical-valuation-axis',
        'data.linkGroup': 'ui-linkage-hint-echo (explicit state; absent = unlinked; broken-link-isolated: server does not mutate panel state)',
        'data.positionBasisAt': 'observed-snapshot as-of instant (frozen OI; null when snapshot asOf unavailable)',
        'data.scenario': 'scenario-caller-supplied-overrides (required; nothing prefilled as observed)',
        'data.frameId': 'route-frame-identity (symbol + snapshot asOf + bound-quote count + reference instant)',
      },
      unitsByField: {
        'data.prices': 'USD',
        'data.timesMs': 'epoch-ms-utc',
        'data.gex.cells[].value': '$/1% move',
        'data.dex.cells[].value': '$Δ notional',
        'data.charm.cells[].value': '$Δ/day',
        'data.profile[].value': '$/1% move',
        'data.profile[].contracts': 'contracts',
        'data.profile[].callGex': '$/1% move',
        'data.profile[].putGex': '$/1% move',
        'data.spotRef': 'USD',
      },
      assumptions: [
        'Hypothetical price × time axes are scenarios, not observed future prices. Only actual historical prices may form candles/price paths.',
        'Frozen OI at the snapshot event time; sticky frozen venue-mark IV per quote; explicit caller-supplied r/q/multiplier/model.',
        'Strike profile is an OI-weighted exposure proxy (not observed dealer inventory); requested market-maker net-contract mode is unavailable.',
        'Gamma units $/1% move, DEX units $Δ notional, and charm units $Δ/day are distinct quantities sharing one frame, not interchangeable.',
        'Optional calendar surface (REF-05): calendar date × hypothetical price signed gamma from the same quote set; dates map to the reference instant UTC clock (first date equals the reference UTC date); exact-spot current exposure is evaluated independently at the canonical spot, never nearest-node; peak is the resolution-dependent grid-node maximum absolute value.',
      ],
      warnings: [...(snapshot.warnings ?? []), ...new Set([...gex.warnings, ...dex.warnings, ...charm.warnings]),
        'BALANCE/TEST: unavailable — no sourced rule or user placement; not inferred from public OI',
        ...(staleSnapshot ? ['canonical snapshot is stale; workbench is computed on frozen stale inputs and stays stale'] : []),
        ...(spotRef == null ? ['no live spot reference: strike profile unavailable'] : [])],
      data,
    });
    return sendContract(request, reply, 'exposureWorkbenchResponse', envelope);
  });
}
