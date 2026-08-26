/**
 * Stripe Billing — server-side only (Fastify plugin).
 *
 * Products: Payments (one-time Checkout), Billing (subscriptions + Customer
 * Portal), Invoicing-ready customer records. Keys never leave the server.
 *
 * Env:
 *   STRIPE_SECRET_KEY        restricted key (rk_...) or secret key (sk_...)
 *   STRIPE_WEBHOOK_SECRET    webhook signing secret (whsec_...)
 *   STRIPE_PRICE_<TIER>_<INTERVAL>   e.g. STRIPE_PRICE_PRO_MONTHLY=price_xxx
 *                            INTERVAL ∈ MONTHLY | ANNUAL | ONETIME
 *   APP_BASE_URL             public origin for success/cancel redirects
 *                            (fallback: RAILWAY_PUBLIC_DOMAIN → localhost:3000)
 *   BILLING_DATA_DIR         persistence dir for entitlements (default .data)
 *
 * Best-practice notes (per docs.stripe.com skills):
 *  - payment_method_types is intentionally OMITTED everywhere → dynamic
 *    payment methods, configured from the Dashboard.
 *  - Fulfillment happens in webhook handlers, never on the success page.
 *  - Webhook signature verification uses the RAW request body; the parser is
 *    registered in an encapsulated scope so no other route is affected.
 */
import Stripe from 'stripe';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getSessionEmail } from './authStore.js';

// ── Price catalog (Dashboard-created prices mapped via env) ──────────────────

const PRICE_ENV_RE = /^STRIPE_PRICE_([A-Z0-9]+)_(MONTHLY|ANNUAL|ONETIME)$/;

function loadPriceCatalog() {
  /** @type {Record<string, {key:string,label:string,monthly?:string,annual?:string,onetime?:string}>} */
  const tiers = {};
  for (const [k, v] of Object.entries(process.env)) {
    const m = PRICE_ENV_RE.exec(k);
    if (!m || !v || !v.startsWith('price_')) continue;
    const [, TIER, INTERVAL] = m;
    const key = TIER.toLowerCase();
    const tier = (tiers[key] ??= {
      key,
      label: key.charAt(0).toUpperCase() + key.slice(1),
      monthly: undefined,
      annual: undefined,
      onetime: undefined,
    });
    tier[INTERVAL.toLowerCase()] = v;
  }
  return Object.values(tiers);
}

function knownPriceIds(tiers) {
  const ids = new Set();
  for (const t of tiers) for (const iv of ['monthly', 'annual', 'onetime']) if (t[iv]) ids.add(t[iv]);
  return ids;
}

// Module-level catalog so entitlement checks can validate priceId membership —
// status alone must not grant access (any stray Dashboard price would otherwise).
const PRICE_CATALOG = loadPriceCatalog();
const KNOWN_PRICE_IDS = knownPriceIds(PRICE_CATALOG);

/** True when the record's price belongs to our catalog. Empty catalog ⇒ allow
 *  (billing configured but no tier mapping yet — don't lock out everyone). */
function priceGrantsAccess(priceId) {
  if (!KNOWN_PRICE_IDS.size) return true;
  return KNOWN_PRICE_IDS.has(priceId);
}

// ── Entitlements store (file-backed; swap for a DB when auth lands) ─────────

const DATA_DIR = process.env.BILLING_DATA_DIR || '.data';
const ENTITLEMENTS_FILE = join(DATA_DIR, 'stripe-entitlements.json');
const AUDIT_FILE = join(DATA_DIR, 'entitlement-audit.jsonl');
/** @type {Map<string, any>} keyed by Stripe customerId */
const entitlements = new Map();

function persistEntitlements() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(ENTITLEMENTS_FILE, JSON.stringify(Object.fromEntries(entitlements), null, 2), { mode: 0o600 });
  } catch (e) {
    console.error('billing: entitlements persist failed', e?.message || e);
  }
}

/** Append-only audit trail for every entitlement change (JSONL, gitignored). */
function appendAudit(entry) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    appendFileSync(AUDIT_FILE, `${JSON.stringify({ ts: Date.now(), ...entry })}\n`);
  } catch (e) {
    console.error('billing: audit append failed', e?.message || e);
  }
}

function loadEntitlements() {
  try {
    if (existsSync(ENTITLEMENTS_FILE)) {
      const raw = JSON.parse(readFileSync(ENTITLEMENTS_FILE, 'utf8'));
      for (const [k, v] of Object.entries(raw)) entitlements.set(k, v);
    }
  } catch (e) {
    console.error('billing: entitlements load failed', e?.message || e);
  }
}
loadEntitlements();

function upsertEntitlement(customerId, patch, source = 'unknown', eventTs = null) {
  if (!customerId) return null;
  const prev = entitlements.get(customerId) || {};
  // Stale-event guard: Stripe redelivers after outages, and an old
  // checkout.session.completed replayed after a later cancellation must NOT
  // resurrect the entitlement. Skip events older than the record's last write.
  if (
    prev.updatedAt &&
    eventTs &&
    eventTs + 5_000 < prev.updatedAt // 5s skew tolerance
  ) {
    appendAudit({
      source,
      event: 'stale_event_skipped',
      customerId,
      email: prev.email || null,
      statusBefore: prev.status ?? null,
      statusAfter: prev.status ?? null,
      patch: { eventTs },
    });
    return prev;
  }
  const next = { ...prev, ...patch, customerId, updatedAt: Date.now() };
  entitlements.set(customerId, next);
  persistEntitlements();
  appendAudit({
    source,
    event: patch.event ?? null,
    customerId,
    email: next.email || null,
    statusBefore: prev.status ?? null,
    statusAfter: next.status ?? null,
    patch,
  });
  return next;
}

// ── Desk gating ──────────────────────────────────────────────────────────────
// Desks behind a subscription. Default: KSA (the only desk backed by a paid,
// budget-tracked vendor feed). Override via BILLING_GATED_DESKS=a,b (or "none").
const GATED_DESKS = (process.env.BILLING_GATED_DESKS || 'ksa')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter((s) => s && s !== 'none');

/** Statuses that keep desk access (dunning keeps access by default). */
function statusGrantsAccess(status) {
  if (['active', 'trialing'].includes(status)) return true;
  // 'paid' = completed one-time (lifetime) Checkout purchase — must unlock.
  if (status === 'paid') return true;
  if (status === 'past_due' && process.env.BILLING_LOCK_ON_PAST_DUE !== '1') return true;
  return false;
}

/** True when the request's authenticated user holds an active subscription. */
export function requestHasAccess(request) {
  const email = getSessionEmail(request);
  if (!email) return false;
  for (const rec of entitlements.values()) {
    // Status alone is not enough: the price must belong to our configured
    // catalog, else any other product on the Stripe account would unlock desks.
    if (
      (rec.email || '').toLowerCase() === email &&
      statusGrantsAccess(rec.status) &&
      priceGrantsAccess(rec.priceId)
    ) {
      return true;
    }
  }
  return false;
}

export function gateInfoForRequest(request) {
  const enabled = billingEnabled();
  return {
    enabled,
    gatedDesks: enabled ? GATED_DESKS : [],
    entitled: enabled ? requestHasAccess(request) : true,
  };
}

// ── Lazy Stripe client ────────────────────────────────────────────────────────

let stripeClient = null;
export function getStripe() {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripeClient = new Stripe(key); // instantiate on the instance, never the deprecated global pattern
  return stripeClient;
}

export function billingEnabled() {
  return !!process.env.STRIPE_SECRET_KEY;
}

/**
 * Public origin for Stripe redirects. The request Host header is only trusted
 * when it appears on an explicit allowlist — otherwise a poisoned Host header
 * would send post-payment redirects (with session ids) to attacker domains.
 */
function publicBaseUrl(request) {
  const envBase = process.env.APP_BASE_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null)
    || (process.env.RENDER_EXTERNAL_URL || null);
  if (envBase) return envBase.replace(/\/$/, '');
  const host = request.headers.host || '';
  const allowed = new Set(
    [
      process.env.RAILWAY_STATIC_URL,
      ...(process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim().replace(/^https?:\/\//, '')),
      'localhost:3000',
      'localhost:5173',
      '127.0.0.1:3000',
      '127.0.0.1:5173',
    ].filter(Boolean),
  );
  if (host && allowed.has(host)) return `${request.protocol}://${host}`;
  return `${request.protocol}://localhost:3000`;
}

/** integration_identifier label suffix — 8 random letters per Stripe guidance. */
function integrationLabel(name) {
  const rand = Array.from({ length: 8 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('');
  return `volaterm_${name}_${rand}`;
}

async function resolveCustomerId(stripe, { customerId, email }) {
  if (customerId) return customerId;
  if (!email) return null;
  // Resolve by email so "Manage subscription" works without stored accounts.
  const res = await stripe.customers.list({ email, limit: 2 });
  return res.data[0]?.id ?? null;
}

// ── Route registration ────────────────────────────────────────────────────────

export async function registerStripeBilling(fastify) {
  const tiers = loadPriceCatalog();
  const priceIds = knownPriceIds(tiers);

  // Desk-gate info consumed by the SPA paywall logic.
  fastify.get('/api/billing/gate', async (request) => gateInfoForRequest(request));

  // Public config consumed by the pricing UI.
  fastify.get('/api/billing/config', async () => {
    const enabled = billingEnabled();
    return {
      enabled,
      portalEnabled: enabled && !!process.env.STRIPE_PORTAL_ENABLED,
      tiers: enabled ? tiers : [],
    };
  });

  // Create a Checkout Session (subscription by default; mode:'payment' for one-time).
  // Rate-limited per-route: each hit creates a real Stripe object (noise + cost).
  fastify.post('/api/billing/checkout-session', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const stripe = getStripe();
    if (!stripe) return reply.code(503).send({ error: 'Billing is not configured.' });

    const { priceId, mode = 'subscription' } = request.body || {};
    // Session identity wins; explicit email is the logged-out fallback.
    const sessionEmail = getSessionEmail(request);
    const email = sessionEmail || request.body?.email;
    // customerId is only honored when it provably belongs to the caller — an
    // unauthenticated caller must not bind payments onto someone else's
    // Stripe customer record (renewal charges, stored methods, entitlements).
    let customerId = request.body?.customerId;
    if (customerId) {
      const rec = entitlements.get(customerId);
      if (!sessionEmail || !rec || (rec.email || '').toLowerCase() !== sessionEmail) {
        customerId = undefined;
      }
    }
    if (!priceId || typeof priceId !== 'string') {
      return reply.code(400).send({ error: 'priceId required' });
    }
    if (!priceIds.has(priceId)) {
      return reply.code(400).send({ error: 'Unknown priceId' });
    }

    try {
      const session = await stripe.checkout.sessions.create({
        mode: mode === 'payment' ? 'payment' : 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        ...(customerId ? { customer: customerId } : email ? { customer_email: String(email).slice(0, 254) } : {}),
        allow_promotion_codes: true,
        success_url: `${publicBaseUrl(request)}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${publicBaseUrl(request)}/?billing=cancelled`,
        metadata: { source: 'volaterm-web' },
        subscription_data: mode === 'subscription'
          ? { metadata: { source: 'volaterm-web' } }
          : undefined,
        // Tag sessions for Dashboard checkout-flow analytics.
        integration_identifier: integrationLabel(mode === 'payment' ? 'onetime' : 'sub'),
      });
      return { id: session.id, url: session.url };
    } catch (err) {
      fastify.log.error({ err }, 'checkout session create failed');
      return reply.code(502).send({ error: 'Checkout session creation failed.' });
    }
  });

  // Customer Portal session — self-serve upgrades / cancel / card update.
  // SECURITY: a portal URL grants full billing control (payment method, cancel,
  // invoices), so it is only ever issued for the CALLER'S OWN verified session
  // email. Unauthenticated callers — or callers naming someone else's email —
  // get 403; otherwise knowing an email would be enough to hijack billing.
  fastify.post('/api/billing/portal-session', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const stripe = getStripe();
    if (!stripe) return reply.code(503).send({ error: 'Billing is not configured.' });

    const sessionEmail = getSessionEmail(request);
    if (!sessionEmail) {
      return reply.code(401).send({ error: 'Sign in to manage billing.' });
    }
    const { email } = request.body || {};
    if (email && String(email).trim().toLowerCase() !== sessionEmail) {
      return reply.code(403).send({ error: 'Portal access is limited to your own billing profile.' });
    }
    try {
      const cid = await resolveCustomerId(stripe, { email: sessionEmail });
      if (!cid) return reply.code(404).send({ error: 'No billing profile found for that email.' });
      const session = await stripe.billingPortal.sessions.create({
        customer: cid,
        return_url: `${publicBaseUrl(request)}/?billing=portal`,
      });
      return { url: session.url };
    } catch (err) {
      fastify.log.error({ err }, 'portal session create failed');
      return reply.code(502).send({ error: 'Portal session failed. Ensure the Customer Portal is activated in the Stripe Dashboard.' });
    }
  });

  // Entitlement lookup (by customerId and/or email).
  // SECURITY: full records (customerId, price, period) are only returned to the
  // signed-in owner of that email. Anonymous callers get a minimal
  // {active} boolean for their own lookup flow — still an existence oracle by
  // design, but it no longer discloses customer/subscription details.
  fastify.get('/api/billing/status', async (request, reply) => {
    const { customerId, email } = request.query || {};
    if (!customerId && !email) return reply.code(400).send({ error: 'customerId or email required' });
    const out = [];
    if (customerId && entitlements.has(customerId)) out.push(entitlements.get(customerId));
    if (email) {
      const em = String(email).toLowerCase();
      for (const rec of entitlements.values()) {
        if ((rec.email || '').toLowerCase() === em) out.push(rec);
      }
    }
    const active = out.some((r) => ['active', 'trialing', 'past_due', 'paid'].includes(r.status));
    const sessionEmail = getSessionEmail(request);
    const ownsAll =
      !!sessionEmail && out.length > 0 && out.every((r) => (r.email || '').toLowerCase() === sessionEmail);
    return {
      active,
      records: ownsAll ? out : [],
    };
  });

  // ── Webhook handler — signature-verified, RAW body ────────────────────────
  // Encapsulated child context so the string body parser does NOT leak to other routes.

  async function handleWebhook(instance, request, reply) {
    const stripe = getStripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !secret) return reply.code(503).send({ error: 'Webhooks not configured.' });

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        request.body, // raw string body (scoped parser above)
        request.headers['stripe-signature'],
        secret,
      );
    } catch (err) {
      instance.log.warn({ err }, 'stripe webhook signature verification failed');
      return reply.code(400).send({ error: 'Invalid signature' });
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded': {
          const session = event.data.object;
          if (session.payment_status === 'unpaid') break; // delayed-notification safety gate
          const email = session.customer_details?.email || session.customer_email || null;
          let priceId = session.metadata?.priceId || null;
          let subStatus = session.mode === 'subscription' ? 'active' : 'paid';
          let currentPeriodEnd = null;

          if (session.subscription) {
            const sub = await stripe.subscriptions.retrieve(session.subscription);
            priceId = sub.items.data[0]?.price?.id || priceId;
            subStatus = sub.status;
            currentPeriodEnd = sub.items.data[0]?.current_period_end
              ? sub.items.data[0].current_period_end * 1000
              : null;
          } else if (!priceId && session.line_items?.data?.length) {
            priceId = session.line_items.data[0]?.price?.id || null;
          }

          upsertEntitlement(session.customer, {
            status: subStatus,
            mode: session.mode,
            priceId,
            email,
            currentPeriodEnd,
            lastSessionId: session.id,
          }, event.type, (event.created || 0) * 1000);
          // TODO fulfillment side effects here (email receipt, unlock desks…)
          break;
        }

        case 'checkout.session.async_payment_failed': {
          const session = event.data.object;
          upsertEntitlement(session.customer, { status: 'payment_failed', mode: session.mode }, event.type, (event.created || 0) * 1000);
          break;
        }

        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          const sub = event.data.object;
          upsertEntitlement(sub.customer, {
            status: sub.status,
            priceId: sub.items.data[0]?.price?.id || null,
            cancelAtPeriodEnd: !!sub.cancel_at_period_end,
            currentPeriodEnd: sub.items.data[0]?.current_period_end
              ? sub.items.data[0].current_period_end * 1000
              : null,
            endedAt: sub.ended_at ? sub.ended_at * 1000 : null,
          }, event.type, (event.created || 0) * 1000);
          break;
        }

        case 'customer.subscription.deleted': {
          const sub = event.data.object;
          upsertEntitlement(sub.customer, { status: 'canceled', endedAt: Date.now() }, event.type, (event.created || 0) * 1000);
          break;
        }

        case 'invoice.paid': {
          const inv = event.data.object;
          // Only refresh KNOWN customers — a bare renewal invoice must never
          // mint an active record for a customer we've never fulfilled.
          if (inv.customer && entitlements.has(inv.customer)) {
            // NEVER pass `status: undefined` into the merge patch — the spread
            // would overwrite a good status with undefined and 402 a paying
            // customer. Only set status when this invoice means something.
            const patch =
              inv.billing_reason === 'subscription_cycle'
                ? { lastInvoicePaidAt: Date.now(), status: 'active' }
                : { lastInvoicePaidAt: Date.now() };
            upsertEntitlement(inv.customer, patch, event.type, (event.created || 0) * 1000);
          }
          break;
        }

        case 'invoice.payment_failed': {
          const inv = event.data.object;
          if (inv.customer && entitlements.has(inv.customer)) {
            upsertEntitlement(inv.customer, { status: 'past_due', lastInvoiceFailedAt: Date.now() }, event.type, (event.created || 0) * 1000);
          }
          break;
        }

        default:
          break; // unhandled types are acknowledged silently
      }
    } catch (err) {
      // Return 500 so Stripe retries with backoff.
      instance.log.error({ err, type: event.type }, 'stripe webhook handler error');
      return reply.code(500).send({ error: 'Handler error' });
    }

    return { received: true };
  }

  await fastify.register(async function webhookScope(instance) {
    instance.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
      done(null, body);
    });
    instance.post('/api/stripe/webhook', { config: { rateLimit: false } }, (req, reply) => handleWebhook(instance, req, reply));
  });
}
