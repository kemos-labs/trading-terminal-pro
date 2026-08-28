/**
 * SAHMK (Saudi market data) — server-only client.
 * Docs: https://www.sahmk.sa/en/developers/docs
 * Keys never leave Node. Shared cache + daily budget.
 *
 * Free-tier workflow (same as AV / TradingView / Finnhub desk):
 *   - Browser only reads GET /api/ksa/* (Node cache).
 *   - Server warmer owns upstream refresh (forceWarm).
 *   - Board pack = 6 calls: TASI, Nomu, gainers, losers, volume, sectors.
 *   - Soft cap ~85/day → ~10–14 packs/day. Open session warm every ~30m ≈ 60 calls.
 *   - User demand never refetches SAHMK when any usable board is cached.
 *   - Per-symbol quote API disabled on free path (board rows only).
 */

import {
  getOrFetch,
  peek,
  budgetAllows,
  recordBudget,
  getBudgetUsed,
  TTL,
  SAHMK_FREE_DAILY,
} from './upstreamCache.js';

const SAHMK_BASE = 'https://app.sahmk.sa/api/v1';
const BUDGET_KEY = 'sahmk';
const BOARD_CACHE_KEY = 'ksa:board:v1';
/** Leave headroom under free 100/day. */
const BUDGET_HEADROOM = 0.85;

/** Preferred mega-cap order when present in volume leaders / movers. */
export const KSA_MEGA_CAPS = ['2222', '1120', '1180', '2010', '7010'];

/** Board pack size (must match loader call count). */
export const KSA_BOARD_UPSTREAM_CALLS = 6;

/** Helper: null-safe finite number — guards null/blank before Number() (Number(null)=0 would fake 0) */
function finiteNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Serialize concurrent budget checks. */
let budgetChain = Promise.resolve();

function withBudgetLock(fn) {
  const run = budgetChain.then(fn, fn);
  budgetChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function softCap() {
  return Math.floor(SAHMK_FREE_DAILY * BUDGET_HEADROOM);
}

/**
 * True if soft cap has room for a full board pack (6 successful calls).
 * Does not pre-charge — charge only after each HTTP 2xx.
 */
export function canAffordBoardPack() {
  return getBudgetUsed(BUDGET_KEY) + KSA_BOARD_UPSTREAM_CALLS <= softCap();
}

/**
 * @deprecated Prefer canAffordBoardPack + charge-on-success. Kept for tests.
 * @param {number} n
 * @returns {boolean}
 */
export function tryReserveBudget(n) {
  const used = getBudgetUsed(BUDGET_KEY);
  if (used + n > softCap()) return false;
  recordBudget(BUDGET_KEY, n);
  return true;
}

/** Whether warmer should pull SAHMK now (budget + TTL + session cadence). */
export function shouldWarmKsaBoard() {
  if (!apiKey()) return false;
  if (!canAffordBoardPack()) return false;
  const hit = peek(BOARD_CACHE_KEY);
  if (hit && Date.now() - hit.timestamp < TTL.SAHMK_BOARD_MS) return false;
  return true;
}

/**
 * Normalize Tadawul symbol: digits only, optional .SR stripped.
 * @param {string} raw
 * @returns {string | null}
 */
export function normalizeKsaSymbol(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().toUpperCase();
  if (s.endsWith('.SR') || s.endsWith('.SA')) s = s.slice(0, -3);
  s = s.replace(/[^0-9]/g, '');
  if (!s || s.length > 6) return null;
  return s;
}

/**
 * Riyadh session snapshot (Sun–Thu continuous approx 10:00–15:20 Asia/Riyadh).
 * @param {Date} [now]
 */
export function riyadhSessionSnapshot(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  const weekday = parts.weekday; // Sun Mon …
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const mins = hour * 60 + minute;
  const openMins = 10 * 60;
  const closeMins = 15 * 60 + 20;
  const tradingDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].includes(weekday);
  const continuous = tradingDay && mins >= openMins && mins < closeMins;
  const preopen = tradingDay && mins >= 9 * 60 + 30 && mins < openMins;
  let phase = 'closed';
  if (preopen) phase = 'preopen';
  else if (continuous) phase = 'open';
  else if (tradingDay && mins >= closeMins && mins < 16 * 60) phase = 'postclose';

  return {
    timezone: 'Asia/Riyadh',
    local: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`,
    weekday,
    tradingDay,
    phase,
    open: continuous,
    sessionNote: 'Equity continuous ~10:00–15:20 Riyadh · week Sun–Thu · T+2 · SAR',
  };
}

function apiKey() {
  return process.env.SAHMK_API_KEY || null;
}

function budgetMeta() {
  return {
    used: getBudgetUsed(BUDGET_KEY),
    capDaily: SAHMK_FREE_DAILY,
    softCap: softCap(),
    note: 'Shared free-tier · warmer owns board · 6 calls/pack · charge-on-success · soft 85/100',
  };
}

/**
 * @param {string} path relative SAHMK path only (no absolute URLs)
 */
async function sahmkGet(path) {
  const key = apiKey();
  if (!key) {
    const err = new Error('SAHMK_API_KEY not configured');
    err.code = 'NO_KEY';
    throw err;
  }

  const ok = await withBudgetLock(() => budgetAllows(BUDGET_KEY, SAHMK_FREE_DAILY, BUDGET_HEADROOM));
  if (!ok) {
    const err = new Error('SAHMK daily budget exhausted');
    err.code = 'BUDGET';
    throw err;
  }

  // Relative path only — no user-controlled absolute URLs.
  const rel = path.startsWith('/') ? path : `/${path}`;
  const url = `${SAHMK_BASE}${rel}`;
  let res;
  try {
    res = await fetch(url, {
      headers: {
        'X-API-Key': key,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    const err = new Error(e.message || 'SAHMK network error');
    err.code = 'UPSTREAM';
    throw err;
  }

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: 'Invalid JSON from SAHMK', raw: text.slice(0, 200) };
  }
  if (!res.ok) {
    const err = new Error(
      (typeof body?.error === 'object' ? body.error.message : body?.error)
        || `SAHMK HTTP ${res.status}`,
    );
    err.status = res.status;
    err.body = body;
    err.code = (typeof body?.error === 'object' && body.error.code) || 'UPSTREAM';
    throw err;
  }
  // Charge only after success (failed HTTP does not burn soft budget).
  recordBudget(BUDGET_KEY, 1);
  return body;
}

async function safeGet(path) {
  try {
    return { ok: true, data: await sahmkGet(path) };
  } catch (e) {
    return {
      ok: false,
      error: e.message || String(e),
      code: e.code || null,
      status: e.status || null,
    };
  }
}

// ── Free-tier depth: history ring (no extra SAHMK calls) ─────
// Each successful board pack appends one print. Charts + session path are free.
const HISTORY_MAX = 96; // ~2 days at 30m warmer cadence
/** @type {Array<object>} */
const boardHistory = [];

/**
 * Snapshot from a usable board for the in-memory history ring.
 * @param {object} board
 */
export function pushBoardHistory(board) {
  if (!isUsableBoard(board)) return;
  const tasi = board.tasi || {};
  const nomu = board.nomu || {};
  const advRaw = tasi.advancing, decRaw = tasi.declining, uncRaw = tasi.unchanged;
  const adv = finiteNum(advRaw);
  const dec = finiteNum(decRaw);
  const unc = finiteNum(uncRaw);
  const sectors = Array.isArray(board.sectors) ? board.sectors : [];
  const ranked = [...sectors]
    .filter((s) => s && Number.isFinite(Number(s.change_percent)))
    .sort((a, b) => Number(b.change_percent) - Number(a.change_percent));
  const topSector = ranked[0] || null;
  const bottomSector = ranked[ranked.length - 1] || null;

  const point = {
    t: board.fetched_at || new Date().toISOString(),
    ts: Date.now(),
    tasi: finiteNum(tasi.index_value) ?? 0,
    tasiChgPct: finiteNum(tasi.index_change_percent),
    nomu: finiteNum(nomu.index_value),
    nomuChgPct: finiteNum(nomu.index_change_percent),
    volume: finiteNum(tasi.total_volume),
    adv,
    dec,
    unc,
    breadth: adv != null && dec != null && (adv + dec) > 0 ? (adv - dec) / (adv + dec) : null,
    mood: tasi.market_mood || null,
    topSector: topSector
      ? { name: topSector.sector_name || topSector.sector_name_ar, pct: Number(topSector.change_percent) }
      : null,
    bottomSector: bottomSector
      ? {
          name: bottomSector.sector_name || bottomSector.sector_name_ar,
          pct: Number(bottomSector.change_percent),
        }
      : null,
  };
  const last = boardHistory[boardHistory.length - 1];
  // Dedupe identical TASI print within 2 minutes (duplicate warm/cold race)
  if (last && last.tasi === point.tasi && point.ts - last.ts < 120_000) return;
  boardHistory.push(point);
  while (boardHistory.length > HISTORY_MAX) boardHistory.shift();
}

export function getBoardHistory() {
  return boardHistory.slice();
}

/**
 * Derived desk analytics from one board snapshot (zero upstream).
 * @param {object} board
 */
export function deriveBoardDepth(board) {
  if (!board) return null;
  const tasi = board.tasi || {};
  // P0 Fix: missing breadth stays null, not 0.
  const advRaw = tasi.advancing;
  const decRaw = tasi.declining;
  const uncRaw = tasi.unchanged;
  const adv = finiteNum(advRaw);
  const dec = finiteNum(decRaw);
  const unc = finiteNum(uncRaw);
  const hasBreadth = adv != null && dec != null && unc != null;
  const total = hasBreadth ? (adv + dec + unc) : null;
  const sectors = Array.isArray(board.sectors) ? board.sectors : [];
  const sectorBars = [...sectors]
    .filter((s) => s && finiteNum(s.change_percent) != null)
    .map((s) => ({
      name: String(s.sector_name || s.sector_name_ar || '?').slice(0, 18),
      pct: finiteNum(s.change_percent) ?? 0,
      volume: finiteNum(s.volume),
      n: finiteNum(s.num_stocks),
    }))
    .sort((a, b) => b.pct - a.pct);

  const movers = [
    ...(board.gainers || []).map((m) => ({ ...m, side: 'up' })),
    ...(board.losers || []).map((m) => ({ ...m, side: 'down' })),
  ];
  const moverBars = movers
    .filter((m) => m && finiteNum(m.change_percent) != null)
    .slice(0, 20)
    .map((m) => ({
      symbol: String(m.symbol),
      name: m.name_en || m.name || m.symbol,
      pct: finiteNum(m.change_percent) ?? 0,
      side: m.side,
    }))
    .sort((a, b) => b.pct - a.pct);

  const volLeaders = (board.volumeLeaders || [])
    .filter((m) => m && finiteNum(m.volume) != null)
    .slice(0, 12)
    .map((m) => ({
      symbol: String(m.symbol),
      name: m.name_en || m.name || m.symbol,
      volume: finiteNum(m.volume) ?? 0,
      pct: finiteNum(m.change_percent),
    }));

  return {
    // Null breadth preserved with unavailable badge — not zero.
    breadth: hasBreadth ? {
      adv,
      dec,
      unc,
      total,
      ratio: (adv + dec) > 0 ? (adv - dec) / (adv + dec) : null,
      advShare: total != null && total > 0 ? adv / total : null,
    } : { adv: null, dec: null, unc: null, total: null, ratio: null, advShare: null, unavailable: true },

    sectorBars,
    moverBars,
    volLeaders,
    history: getBoardHistory(),
    historyNote:
      'TASI path from server warmer samples only (no extra SAHMK). Builds over the day after each pack.',
  };
}

/**
 * Build mega strip from movers (no extra quote API calls).
 * @param {object[]} volumeLeaders
 * @param {object[]} gainers
 * @param {object[]} losers
 */
export function buildMegaFromMovers(volumeLeaders, gainers, losers) {
  const bySym = new Map();
  for (const row of [...(volumeLeaders || []), ...(gainers || []), ...(losers || [])]) {
    if (!row?.symbol || bySym.has(String(row.symbol))) continue;
    bySym.set(String(row.symbol), row);
  }
  const ordered = [];
  for (const sym of KSA_MEGA_CAPS) {
    const hit = bySym.get(sym);
    if (hit) ordered.push({ ...hit, symbol: sym });
  }
  // Fill remaining slots from volume leaders
  for (const row of volumeLeaders || []) {
    if (ordered.length >= 5) break;
    const sym = String(row.symbol);
    if (ordered.some((m) => m.symbol === sym)) continue;
    ordered.push({ ...row, symbol: sym });
  }
  return ordered;
}

/**
 * True when board has a usable TASI print (safe to cache / display as live board).
 * @param {object} data
 */
export function isUsableBoard(data) {
  return !!(data
    && data.configured !== false
    && data.tasi
    && data.tasi.index_value != null
    && Number.isFinite(Number(data.tasi.index_value)));
}

/**
 * Find a row for symbol across board collections.
 * @param {object} board
 * @param {string} sym
 */
export function findOnBoard(board, sym) {
  if (!board || !sym) return null;
  const pools = [
    board.mega,
    board.gainers,
    board.losers,
    board.volumeLeaders,
    board.valueLeaders,
  ];
  for (const pool of pools) {
    const hit = (pool || []).find((m) => String(m.symbol) === sym && m.price != null);
    if (hit) return hit;
  }
  return null;
}

/**
 * Load board pack from SAHMK (throws on budget or unusable TASI).
 * @returns {Promise<object>}
 */
async function loadBoardPack() {
  if (!canAffordBoardPack()) {
    const err = new Error('SAHMK daily budget exhausted');
    err.code = 'BUDGET';
    throw err;
  }

  // Sequential groups: fail-fast on TASI (critical); rest parallel.
  // Each successful safeGet charges 1; failures do not pre-burn the pack.
  const tasi = await safeGet('/market/summary/?index=TASI&data_mode=delayed');
  if (!tasi.ok || tasi.data?.index_value == null) {
    const err = new Error(tasi.error || 'TASI summary unavailable');
    err.code = tasi.code || 'UPSTREAM';
    throw err;
  }

  const [nomu, gainers, losers, volume, sectors] = await Promise.all([
    safeGet('/market/summary/?index=NOMU&data_mode=delayed'),
    safeGet('/market/gainers/?index=TASI&limit=10&data_mode=delayed'),
    safeGet('/market/losers/?index=TASI&limit=10&data_mode=delayed'),
    safeGet('/market/volume/?index=TASI&limit=10&data_mode=delayed'),
    safeGet('/market/sectors/?index=TASI&data_mode=delayed'),
  ]);

  const gList = gainers.ok ? (gainers.data?.gainers || []) : [];
  const lList = losers.ok ? (losers.data?.losers || []) : [];
  const vList = volume.ok ? (volume.data?.stocks || []) : [];
  const mega = buildMegaFromMovers(vList, gList, lList);

  const partialErrors = [nomu, gainers, losers, volume, sectors]
    .filter((x) => !x.ok)
    .map((x) => x.error);

  const pack = {
    configured: true,
    tasi: tasi.data,
    nomu: nomu.ok ? nomu.data : { error: nomu.error },
    gainers: gList,
    losers: lList,
    volumeLeaders: vList,
    /** P0 Fix: no fake value leaders on free tier — true traded value unavailable */
    valueLeaders: [],
    sectors: sectors.ok ? (sectors.data?.sectors || []) : [],
    mega,
    errors: partialErrors,
    is_delayed: true,
    data_mode: 'delayed',
    source: 'sahmk',
    budget: budgetMeta(),
    fetched_at: new Date().toISOString(),
  };
  pushBoardHistory(pack);
  return pack;
}

function ensureHistorySeed(data) {
  if (getBoardHistory().length === 0 && isUsableBoard(data)) {
    pushBoardHistory(data);
  }
}

function wrapBoard(data, hitTs, { stale = false, error, code } = {}) {
  const ageMs = hitTs != null ? Date.now() - hitTs : 0;
  ensureHistorySeed(data);
  return {
    ...data,
    depth: deriveBoardDepth(data),
    session: riyadhSessionSnapshot(),
    fromCache: true,
    ageMs,
    stale: !!stale,
    ...(error ? { error, code: code || 'STALE' } : {}),
    budget: budgetMeta(),
    as_of: data.fetched_at || new Date().toISOString(),
  };
}

/**
 * Shared market pulse board — one cache key for all visitors.
 * @param {{ forceWarm?: boolean }} [opts]
 *   forceWarm=true → server warmer only; may hit SAHMK when TTL expired + budget ok.
 *   Default (browser/API demand) → serve any usable cached board; cold miss only if empty.
 */
export async function fetchKsaBoard(opts = {}) {
  const forceWarm = !!opts.forceWarm;
  const session = riyadhSessionSnapshot();
  if (!apiKey()) {
    return {
      configured: false,
      session,
      error: 'SAHMK_API_KEY not configured',
      code: 'NO_KEY',
      hint: 'Set SAHMK_API_KEY in server .env (https://www.sahmk.sa/en/developers). Free tier: 100 req/day delayed.',
      source: 'sahmk',
      as_of: new Date().toISOString(),
    };
  }

  const hit = peek(BOARD_CACHE_KEY);
  const usable = hit?.data && isUsableBoard(hit.data);
  const ageMs = hit ? Date.now() - hit.timestamp : null;
  const fresh = usable && ageMs != null && ageMs < TTL.SAHMK_BOARD_MS;

  // Always serve shared board to browsers when present (warmer refreshes).
  if (usable && (!forceWarm || fresh)) {
    return wrapBoard(hit.data, hit.timestamp, {
      stale: !fresh,
      ...(forceWarm ? {} : !fresh ? { error: 'awaiting_warmer', code: 'AWAITING_WARMER' } : {}),
    });
  }

  if (!canAffordBoardPack()) {
    if (usable) {
      return wrapBoard(hit.data, hit.timestamp, {
        stale: true,
        error: 'SAHMK soft budget — serving last shared board',
        code: 'BUDGET',
      });
    }
    return {
      configured: true,
      unusable: true,
      session,
      error: 'SAHMK daily budget exhausted',
      code: 'BUDGET',
      source: 'sahmk',
      budget: budgetMeta(),
      as_of: new Date().toISOString(),
    };
  }

  // Cold start (no board yet) or warmer force after TTL.
  try {
    const { data, fromCache, ageMs: loadedAge, stale } = await getOrFetch(
      BOARD_CACHE_KEY,
      TTL.SAHMK_BOARD_MS,
      loadBoardPack,
      {
        force: forceWarm,
        allowStaleOnError: true,
        cacheIf: isUsableBoard,
      },
    );

    ensureHistorySeed(data);
    return {
      ...data,
      depth: deriveBoardDepth(data),
      session: riyadhSessionSnapshot(),
      fromCache,
      ageMs: loadedAge,
      stale: !!stale,
      budget: data.budget || budgetMeta(),
      as_of: data.fetched_at || new Date().toISOString(),
    };
  } catch (e) {
    const staleHit = peek(BOARD_CACHE_KEY);
    if (staleHit?.data && isUsableBoard(staleHit.data)) {
      return wrapBoard(staleHit.data, staleHit.timestamp, {
        stale: true,
        error: e.message,
        code: e.code || 'UPSTREAM',
      });
    }
    return {
      configured: true,
      unusable: true,
      session,
      error: e.message || String(e),
      code: e.code || 'UPSTREAM',
      source: 'sahmk',
      budget: budgetMeta(),
      as_of: new Date().toISOString(),
    };
  }
}

/**
 * Symbol detail from shared board only (free tier — no per-symbol /quote fan-out).
 * @param {string} symbol
 */
export async function fetchKsaQuote(symbol) {
  const sym = normalizeKsaSymbol(symbol);
  if (!sym) {
    return {
      error: 'Invalid symbol',
      code: 'INVALID',
      hint: 'Use numeric Tadawul codes e.g. 2222',
    };
  }
  const session = riyadhSessionSnapshot();
  if (!apiKey()) {
    return {
      configured: false,
      symbol: sym,
      session,
      error: 'SAHMK_API_KEY not configured',
      code: 'NO_KEY',
      source: 'sahmk',
    };
  }

  // Board first (any age — shared pack).
  const boardPeek = peek(BOARD_CACHE_KEY);
  if (boardPeek?.data) {
    const hit = findOnBoard(boardPeek.data, sym);
    if (hit) {
      return {
        configured: true,
        symbol: sym,
        quote: hit,
        fromCache: true,
        ageMs: Date.now() - boardPeek.timestamp,
        stale: Date.now() - boardPeek.timestamp >= TTL.SAHMK_BOARD_MS,
        source: 'sahmk',
        data_mode: 'delayed',
        session,
        budget: budgetMeta(),
        as_of: boardPeek.data.fetched_at || new Date().toISOString(),
        note: 'From shared board · no per-symbol SAHMK call',
      };
    }
  }

  // Stale single-quote cache only (legacy); never new upstream on free path.
  const qStale = peek(`ksa:quote:${sym}`);
  if (qStale?.data?.price != null) {
    return {
      configured: true,
      symbol: sym,
      quote: qStale.data,
      fromCache: true,
      ageMs: Date.now() - qStale.timestamp,
      stale: true,
      source: 'sahmk',
      data_mode: 'delayed',
      session,
      budget: budgetMeta(),
      as_of: qStale.data?.updated_at || new Date().toISOString(),
      note: 'Stale quote cache · board warmer is source of truth',
    };
  }

  return {
    configured: true,
    symbol: sym,
    error: 'Not on shared board',
    code: 'NOT_ON_BOARD',
    hint: 'Pick a name from movers / volume on the KSA board. Free tier does not call /quote per symbol.',
    source: 'sahmk',
    session,
    budget: budgetMeta(),
    as_of: new Date().toISOString(),
  };
}

export function sahmkBudgetStatus() {
  return {
    used: getBudgetUsed(BUDGET_KEY),
    capDaily: SAHMK_FREE_DAILY,
    softCap: softCap(),
    configured: !!apiKey(),
  };
}
