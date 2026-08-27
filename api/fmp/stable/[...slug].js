import { isFmpEndpointAllowed, proxyFmp } from '../../_shared.js';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const slug = url.pathname.replace(/^\/api\/fmp\/stable\/?/, '') || '';

  if (!isFmpEndpointAllowed(slug)) {
    res.status(403).json({ error: 'Endpoint not allowed' });
    return;
  }

  const apiKey = process.env.FMP_API_KEY;
  const qs = url.searchParams.toString();
  const endpoint = qs ? `${slug}?${qs}` : slug;

  const { status, body } = await proxyFmp(endpoint, apiKey);
  res.status(status).json(body);
}
