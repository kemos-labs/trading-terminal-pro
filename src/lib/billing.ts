/**
 * Billing client — talks to server-side Stripe endpoints (server.js).
 * No Stripe SDK in the browser bundle: Checkout/Portal are plain redirects,
 * so no card data or keys ever reach Vite/client code.
 */

export type BillingInterval = 'monthly' | 'annual' | 'onetime';

export interface BillingTier {
  key: string;
  label: string;
  monthly?: string;
  annual?: string;
  onetime?: string;
}

export interface BillingConfig {
  enabled: boolean;
  portalEnabled: boolean;
  tiers: BillingTier[];
}

export interface EntitlementRecord {
  customerId: string;
  status: string;
  mode?: string;
  priceId?: string | null;
  email?: string | null;
  currentPeriodEnd?: number | null;
  cancelAtPeriodEnd?: boolean;
  updatedAt?: number;
}

export interface BillingStatus {
  active: boolean;
  records: EntitlementRecord[];
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  return body as T;
}

export async function fetchBillingConfig(): Promise<BillingConfig> {
  return json(await fetch('/api/billing/config'));
}

/** Creates a Checkout Session and returns its hosted URL to redirect to. */
export async function createCheckoutSession(opts: {
  priceId: string;
  email?: string;
  mode?: 'subscription' | 'payment';
}): Promise<{ id: string; url: string }> {
  return json(
    await fetch('/api/billing/checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    }),
  );
}

/** Creates a Customer Portal session URL for self-serve management. */
export async function createPortalSession(opts: { email?: string; customerId?: string }): Promise<{ url: string }> {
  return json(
    await fetch('/api/billing/portal-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    }),
  );
}

export async function fetchBillingStatus(q: { email?: string; customerId?: string }): Promise<BillingStatus> {
  const search = new URLSearchParams();
  if (q.email) search.set('email', q.email);
  if (q.customerId) search.set('customerId', q.customerId);
  return json(await fetch(`/api/billing/status?${search.toString()}`));
}
