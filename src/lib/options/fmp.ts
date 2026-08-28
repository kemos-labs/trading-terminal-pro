import type { VolSnapshot } from './types';
import { buildYahooSnapshot, type YahooRawOption, type YahooResponse } from './yahoo';
import type {
  FmpOptionContract,
  FmpExpiryGroup,
  FmpOptionsResponse,
  FmpQuote,
} from '../data/types';
import { fmpGet, type FmpResult } from '../data/fmpClient';

/**
 * Live data source backed by Financial Modeling Prep.
 *
 * FMP supplies the option chain (`options/symbol`) and the spot price (`quote`).
 * We map the chain into the same shape yahoo.ts uses, then reuse its full
 * pipeline (arbitrage filtering, IV solving, SVI wing smoothing, surface build)
 * so both live providers share one code path.
 *
 * NOTE: FMP options data is a separate (paid) package and is NOT in the public
 * stable catalog. If the endpoint is unavailable on your plan, this throws a
 * descriptive error instead of failing silently.
 */

/** Fetch through the server proxy (cached in fmpClient) preserving status + error. */
async function fmpGetCached(endpoint: string): Promise<FmpResult> {
  const res = await fmpGet(endpoint, { ttl: 300_000, negativeTtl: 300_000 });
  // Mirror the legacy FmpResult shape (status 0 = cached failure / network error).
  return res;
}

function toRaw(c: FmpOptionContract, expiryFallback: string): YahooRawOption | null {
  const type = (c.optionType ?? c.type) as 'call' | 'put' | undefined;
  if (type !== 'call' && type !== 'put') return null;

  const strike = Number(c.strike);
  if (!isFinite(strike) || strike <= 0) return null;

  const expiry = c.expirationDate ?? expiryFallback;
  if (!expiry) return null;

  const iv = c.impliedVolatility != null ? Number(c.impliedVolatility) : null;

  // P0: preserve per-field provenance — missing stays null, not 0.
  const bidNum = c.bid != null ? Number(c.bid) : NaN;
  const askNum = c.ask != null ? Number(c.ask) : NaN;
  const lastNum = (c.last ?? c.close) != null ? Number(c.last ?? c.close) : NaN;
  const volNum = c.volume != null ? Number(c.volume) : NaN;
  const oiNum = c.openInterest != null ? Number(c.openInterest) : NaN;
  return {
    strike,
    expiry,
    type,
    bid: isFinite(bidNum) && bidNum > 0 ? bidNum : null,
    ask: isFinite(askNum) && askNum > 0 ? askNum : null,
    last: isFinite(lastNum) && lastNum > 0 ? lastNum : null,
    iv: iv != null && isFinite(iv) ? iv : null,
    volume: isFinite(volNum) && volNum >= 0 ? volNum : null,
    openInterest: isFinite(oiNum) && oiNum >= 0 ? oiNum : null,
  };
}

export function normalizeFmp(resp: FmpOptionsResponse): YahooRawOption[] {
  const out: YahooRawOption[] = [];

  // Legacy object shape: { symbol, expirations, options: [...] }
  const legacy = resp as unknown as { options?: FmpOptionContract[] };
  if (legacy && Array.isArray(legacy.options)) {
    for (const c of legacy.options) {
      const raw = toRaw(c, c.expirationDate ?? '');
      if (raw) out.push(raw);
    }
    return out;
  }

  for (const item of resp) {
    if (item && Array.isArray((item as FmpExpiryGroup).data)) {
      const grp = item as FmpExpiryGroup;
      const exp = grp.expirationDate ?? '';
      for (const c of grp.data ?? []) {
        const raw = toRaw(c, exp);
        if (raw) out.push(raw);
      }
    } else {
      const raw = toRaw(item as FmpOptionContract, (item as FmpOptionContract).expirationDate ?? '');
      if (raw) out.push(raw);
    }
  }

  return out;
}

export async function fetchFmpSnapshot(
  symbol: string,
  maxExpiries = 12,
  r = 0.0525,
  q = 0.013,
): Promise<VolSnapshot> {
  const opt = await fmpGetCached(`options/symbol/${encodeURIComponent(symbol)}`);
  if (opt.error) {
    throw new Error(`FMP options chain failed — ${opt.error}`);
  }
  const raw = opt.json as FmpOptionsResponse | null;
  if (!raw) {
    throw new Error('FMP options chain returned no data');
  }

  const quotes = normalizeFmp(raw);
  if (quotes.length < 5) {
    throw new Error(`FMP returned too few option contracts (${quotes.length}) for ${symbol}`);
  }

  const qres = await fmpGetCached(`quote?symbol=${encodeURIComponent(symbol)}`);
  if (qres.error) {
    throw new Error(`FMP spot quote failed — ${qres.error}`);
  }
  const quotesArr = qres.json as FmpQuote[] | null;
  const spot = quotesArr && quotesArr.length > 0 && isFinite(quotesArr[0]!.price) ? quotesArr[0]!.price : null;
  if (spot == null || spot <= 0) {
    throw new Error(`FMP spot quote missing or invalid for ${symbol}`);
  }

  const data: YahooResponse = {
    symbol,
    spot,
    expirations: [...new Set(quotes.map((x) => x.expiry))],
    quotes,
    timestamp: Date.now(),
  };

  const snap = buildYahooSnapshot(data, r, q, maxExpiries);
  if (!snap) {
    throw new Error('Failed to build volatility surface from FMP data');
  }
  return snap;
}
