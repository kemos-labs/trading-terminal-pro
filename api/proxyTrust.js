/**
 * Explicit proxy trust resolution — never a boolean "trust everything".
 *
 * Fastify's `trustProxy` decides which TCP peers may set X-Forwarded-For /
 * X-Forwarded-Proto / Host. A production boolean `true` lets ANY client spoof
 * `request.ip` by sending `X-Forwarded-For`, which poisons rate-limit buckets,
 * audit logs and auth throttling. Fastify guidance is to trust a specific
 * hop count / IP / CIDR list or supply a custom validation function.
 *
 * Resolution order (fail-closed — invalid config ABORTS startup, it never
 * silently widens trust):
 *
 *   1. TRUST_PROXY_CIDRS   comma-separated trusted peer IPs/CIDRs
 *                          (preferred: exact ingress allowlist).
 *   2. TRUST_PROXY_HOPS    integer 1..8 — trust exactly N proxy hops
 *                          (e.g. a Render/Railway/Cloudfront single edge → 1).
 *   3. TRUST_PROXY=1|true  legacy alias for TRUST_PROXY_HOPS=1. Deprecated:
 *                          logs a warning telling operators to migrate.
 *                          Any other legacy value is IGNORED (no trust).
 *   Nothing set ⇒ trust nobody (direct exposure / local dev default).
 */
import net from 'node:net';

const HOPS_MIN = 1;
const HOPS_MAX = 8;

function isIp(value) {
  return net.isIP(value) !== 0;
}

/**
 * Validates one "ip" or "ip/prefix" entry and returns it verbatim.
 * Throws on anything malformed so callers can fail closed at boot.
 */
export function validateCidrEntry(entry) {
  const value = entry.trim();
  if (!value) throw new Error('TRUST_PROXY_CIDRS contains an empty entry');
  if (isIp(value)) return value;
  const slash = value.indexOf('/');
  if (slash === -1) {
    throw new Error(`TRUST_PROXY_CIDRS entry "${value}" is not an IP or IP/bits CIDR`);
  }
  const ip = value.slice(0, slash);
  const bitsRaw = value.slice(slash + 1);
  const bits = Number(bitsRaw);
  if (!Number.isInteger(bits)) {
    throw new Error(`TRUST_PROXY_CIDRS entry "${value}" has a non-integer prefix length`);
  }
  switch (net.isIP(ip)) {
    case 4:
      if (bits < 0 || bits > 32) {
        throw new Error(`TRUST_PROXY_CIDRS IPv4 entry "${value}" prefix must be 0..32`);
      }
      break;
    case 6:
      if (bits < 0 || bits > 128) {
        throw new Error(`TRUST_PROXY_CIDRS IPv6 entry "${value}" prefix must be 0..128`);
      }
      break;
    default:
      throw new Error(`TRUST_PROXY_CIDRS entry "${value}" does not start with a valid IP`);
  }
  return value;
}

/** Validates a comma-separated CIDR/IP list; returns entries or throws. */
export function parseCidrList(raw) {
  const entries = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!entries.length) {
    throw new Error('TRUST_PROXY_CIDRS set but empty after parsing');
  }
  return entries.map(validateCidrEntry);
}

function parseIntInRange(raw, name) {
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < HOPS_MIN || n > HOPS_MAX) {
    throw new Error(`${name} must be an integer between ${HOPS_MIN} and ${HOPS_MAX}`);
  }
  return n;
}

/**
 * Resolves the Fastify trustProxy policy from environment variables.
 * Never throws for absent configuration; throws on MALFORMED explicit
 * configuration (fail closed rather than silently trusting nobody while an
 * operator believes their ingress ranges are honored).
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{trustProxy: string[]|number|false, source: 'cidrs'|'hops'|'none'|'legacy', warnings: string[]}}
 */
export function resolveProxyTrust(env = process.env) {
  const warnings = [];
  const cidrs = env.TRUST_PROXY_CIDRS;
  if (cidrs != null && cidrs !== '') {
    return { trustProxy: parseCidrList(cidrs), source: 'cidrs', warnings };
  }

  const hops = env.TRUST_PROXY_HOPS;
  if (hops != null && hops !== '') {
    return { trustProxy: parseIntInRange(hops, 'TRUST_PROXY_HOPS'), source: 'hops', warnings };
  }

  // Legacy boolean behavior. "1"/"true" meant "behind exactly one edge hop" in
  // this repository; other values historically enabled nothing.
  const legacy = String(env.TRUST_PROXY || '').toLowerCase();
  if (legacy === '1' || legacy === 'true') {
    warnings.push(
      'TRUST_PROXY=1 is deprecated — set TRUST_PROXY_HOPS=1 or TRUST_PROXY_CIDRS=<ingress IPs> instead.',
    );
    return { trustProxy: HOPS_MIN, source: 'legacy', warnings };
  }
  if (legacy !== '') {
    warnings.push(
      `TRUST_PROXY="${env.TRUST_PROXY}" is ignored — use TRUST_PROXY_HOPS or TRUST_PROXY_CIDRS.`,
    );
  }
  return { trustProxy: false, source: 'none', warnings };
}
