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
      return { error: 'UNSUPPORTED_CURRENCY' };
    }
    try {
      return await fetchFreeCryptoMarket(currency);
    } catch (err) {
      const status = err.status === 400 ? 400 : 502;
      reply.code(status);
      return { error: status === 400 ? 'UNSUPPORTED_CURRENCY' : 'FREE_CRYPTO_UNAVAILABLE' };
    }
  });
}
