/**
 * SSE spot stream — pushes FMP quote ticks to the browser.
 * Backpressure-aware: respects write() return value, drains on 'drain' event,
 * bounded queue (oldest drop), disconnect cleanup.
 */
import { fetchFmpQuoteShared } from '../../api/_shared.js';
import { validateSymbol } from '../validation.js';

const STALE_MS = 90_000;
const STALE_DATA_MS = 90_000;
const MAX_FAILURES = 5;
const QUEUE_MAX = 10;

export async function registerSseRoutes(fastify) {
  fastify.get('/api/stream/quote/:symbol', async (request, reply) => {
    const symbol = validateSymbol(request.params.symbol);
    if (!symbol) { reply.code(400); return { error: 'Invalid symbol' }; }

    const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:3000').split(',').map(o => o.trim()).filter(Boolean);
    const origin = request.headers.origin;
    const allowOrigin = !origin || ALLOWED_ORIGINS.includes(origin) ? (origin || ALLOWED_ORIGINS[0]) : null;
    if (origin && !allowOrigin) { reply.code(403); return { error: 'Not allowed by CORS' }; }

    reply.hijack();
    const headers = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    };
    if (allowOrigin) {
      headers['Access-Control-Allow-Origin'] = allowOrigin;
      headers['Access-Control-Allow-Credentials'] = 'true';
    }
    reply.raw.writeHead(200, headers);
    reply.raw.write(': connected\n\n');

    let closed = false;
    let lastGoodTickAt = 0;
    let consecutiveFailures = 0;
    let draining = false;
    let queue = [];
    let timer = null;
    let retune = null;
    let watchdog = null;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      queue = [];
      if (timer) clearInterval(timer);
      if (retune) clearInterval(retune);
      if (watchdog) clearInterval(watchdog);
      try { reply.raw.removeAllListeners('drain'); } catch { /* ignore */ }
      try { reply.raw.end(); } catch { /* ignore */ }
    };

    const send = (data) => {
      if (closed) return;
      if (draining) {
        if (queue.length < QUEUE_MAX) queue.push(data);
        else { queue.shift(); queue.push(data); } // drop oldest — bounded
        return;
      }
      const ok = reply.raw.write(data);
      if (!ok) {
        // write() false means the current event was already accepted into the
        // stream buffer — do NOT queue it again or it will duplicate after drain.
        draining = true;
        const onDrain = () => {
          draining = false;
          while (queue.length > 0 && !draining) {
            const next = queue.shift();
            const ok2 = reply.raw.write(next);
            if (!ok2) {
              draining = true;
              reply.raw.once('drain', onDrain);
              break;
            }
          }
        };
        reply.raw.once('drain', onDrain);
      }
    };

    const writeTick = async () => {
      if (closed) return;
      try {
        const FMP_API_KEY = process.env.FMP_API_KEY || null;
        const FMP_BASE = 'https://financialmodelingprep.com/api/v4';
        const { quote, ageMs, stale, error } = await fetchFmpQuoteShared(symbol, FMP_API_KEY, FMP_BASE);
        if (error === 'no_api_key') {
          send(`data: ${JSON.stringify({ error: 'no_api_key', timestamp: Date.now() })}\n\n`);
          send(`data: ${JSON.stringify({ error: 'stream_stale', timestamp: Date.now() })}\n\n`);
          cleanup();
          return;
        }
        if (quote && quote.price > 0) {
          const payload = { symbol: quote.symbol || symbol, price: quote.price, change: quote.change, changePercentage: quote.changePercentage, ageMs, stale: !!stale || ageMs > STALE_DATA_MS, timestamp: Date.now(), source: 'fmp' };
          if (!stale && ageMs <= STALE_DATA_MS) { lastGoodTickAt = Date.now(); consecutiveFailures = 0; }
          send(`data: ${JSON.stringify(payload)}\n\n`);
          if (stale || ageMs > STALE_DATA_MS) {
            consecutiveFailures += 1;
            if (consecutiveFailures >= MAX_FAILURES) {
              send(`data: ${JSON.stringify({ error: 'stream_stale', timestamp: Date.now() })}\n\n`);
              cleanup();
            }
          }
        } else if (error === 'budget_exhausted') {
          consecutiveFailures += 1;
          send(`data: ${JSON.stringify({ error: 'fmp_budget_exhausted', timestamp: Date.now() })}\n\n`);
          if (consecutiveFailures >= 2) {
            send(`data: ${JSON.stringify({ error: 'stream_stale', timestamp: Date.now() })}\n\n`);
            cleanup();
          }
        } else {
          consecutiveFailures += 1;
          send(`data: ${JSON.stringify({ error: error || 'tick_failed', timestamp: Date.now(), consecutiveFailures })}\n\n`);
          if (consecutiveFailures >= MAX_FAILURES || (lastGoodTickAt > 0 && Date.now() - lastGoodTickAt > STALE_MS)) {
            send(`data: ${JSON.stringify({ error: 'stream_stale', timestamp: Date.now() })}\n\n`);
            cleanup();
          }
        }
      } catch (err) {
        consecutiveFailures += 1;
        send(`data: ${JSON.stringify({ error: 'tick_failed', detail: String(err.message || err), timestamp: Date.now() })}\n\n`);
        if (consecutiveFailures >= MAX_FAILURES) cleanup();
      }
    };

    await writeTick();
    const openMs = 12_000;
    const closedMs = 60_000;
    const pickInterval = () => {
      const et = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
      if (/\bSat\b|\bSun\b/.test(et)) return closedMs;
      const hm = et.match(/(\d{1,2}):(\d{2})/);
      if (!hm) return openMs;
      let h = Number(hm[1]);
      const m = Number(hm[2]);
      if (h === 24) h = 0;
      const mins = h * 60 + m;
      return mins >= 9 * 60 + 30 && mins < 16 * 60 ? openMs : closedMs;
    };

    timer = setInterval(writeTick, pickInterval());
    retune = setInterval(() => { clearInterval(timer); timer = setInterval(writeTick, pickInterval()); }, 60_000);
    watchdog = setInterval(() => {
      if (closed) return;
      if (lastGoodTickAt > 0 && Date.now() - lastGoodTickAt > STALE_MS) {
        try { send(`data: ${JSON.stringify({ error: 'stream_stale', timestamp: Date.now() })}\n\n`); } catch { /* ignore */ }
        cleanup();
      }
    }, 15_000);

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });
}
