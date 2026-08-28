import { fetchFreeCryptoMarket } from '../providers/freeCrypto/client.js';

function parseCurrency(value) {
  const c = String(value || '').trim().toUpperCase();
  return c === 'BTC' || c === 'ETH' ? c : null;
}

export async function registerFreeCryptoMarketRoutes(fastify) {
  fastify.get('/api/free-crypto/market/:currency', async (request, reply) => {
    const currency = parseCurrency(request.params.currency);
    if (!currency) {
      reply.code(400);
      return { error: 'currency must be BTC or ETH' };
    }
    try {
      return await fetchFreeCryptoMarket(currency);
    } catch (err) {
      reply.code(err.status === 400 ? 400 : 502);
      return { error: 'Free crypto market unavailable', detail: String(err.message || err) };
    }
  });
}
