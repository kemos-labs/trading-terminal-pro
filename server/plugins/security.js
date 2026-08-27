import { registerSecurityHeaders } from '../../api/securityHeaders.js';
import { resolveProxyTrust } from '../../api/proxyTrust.js';

export async function registerSecurity(app) {
  await registerSecurityHeaders(app);
  return { trust: resolveProxyTrust() };
}
