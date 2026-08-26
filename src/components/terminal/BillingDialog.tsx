import { useCallback, useEffect, useRef, useState } from 'react';
import { CreditCard, ExternalLink, X } from 'lucide-react';
import {
  createCheckoutSession,
  createPortalSession,
  fetchBillingConfig,
  fetchBillingStatus,
  type BillingConfig,
  type BillingTier,
  type BillingStatus,
} from '../../lib/billing';
import { login, register, confirmPasswordReset, requestPasswordReset } from '../../lib/auth';
import { useAccountStore } from '../../store/accountStore';

type Phase = 'idle' | 'working' | 'error' | 'done';
type AuthMode = 'register' | 'login' | 'forgot' | 'forgot-confirm';

const INTERVAL_LABEL: Record<string, string> = {
  monthly: '/mo',
  annual: '/yr',
  onetime: '',
};

/**
 * Account + pricing overlay: sign in / register, subscribe via Stripe-hosted
 * Checkout, self-serve via Customer Portal. The client never touches card
 * data — everything is a redirect.
 */
export function BillingDialog() {
  const close = useCallback(() => setBillingOpen(false), []);
  const { user, billingOpen } = useAccountStore();
  const refreshAccount = useAccountStore((s) => s.refresh);
  const setBillingOpen = useAccountStore((s) => s.setBillingOpen);

  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<AuthMode>('register');
  const [resetToken, setResetToken] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => {
      mounted.current = false;
      window.removeEventListener('keydown', onKey);
    };
  }, [close]);

  // Reset transient state each time the dialog opens; sync email from account.
  useEffect(() => {
    if (!billingOpen) return;
    setPhase('idle');
    setMessage('');
    setEmail(user?.email ?? '');
    setResetToken('');
    void refreshAccount();
    void run(async () => {
      const cfg = await fetchBillingConfig();
      if (mounted.current) setConfig(cfg);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingOpen]);

  const run = useCallback(async (fn: () => Promise<void>, okMsg?: string) => {
    setPhase('working');
    setMessage('');
    try {
      await fn();
      if (!mounted.current) return;
      setPhase(okMsg ? 'done' : 'idle');
      if (okMsg) setMessage(okMsg);
    } catch (err) {
      if (!mounted.current) return;
      setPhase('error');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const loadStatus = useCallback((forEmail: string) => {
    void run(async () => {
      setStatus(await fetchBillingStatus({ email: forEmail }));
    });
  }, [run]);

  // Signed-in ⇒ load entitlements automatically.
  useEffect(() => {
    if (billingOpen && user) loadStatus(user.email);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billingOpen, user?.email]);

  // Post-redirect state (?billing=success|cancelled|portal)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billingState = params.get('billing');
    if (!billingState) return;
    params.delete('billing');
    params.delete('session_id');
    window.history.replaceState(null, '', `${window.location.pathname}${params.toString() ? `?${params}` : ''}`);
    if (billingState === 'success') {
      setPhase('done');
      setMessage('Payment received — access is being provisioned.');
    } else if (billingState === 'cancelled') {
      setMessage('Checkout cancelled.');
    }
  }, []);

  const submitAuth = useCallback(() => {
    const okMsg =
      authMode === 'forgot'
        ? 'If that account exists, a reset code was issued — retrieve it from the server console (no email delivery is configured).'
        : authMode === 'forgot-confirm'
          ? 'Password updated — you are signed in.'
          : authMode === 'register'
            ? 'Account created — you are signed in.'
            : undefined;
    void run(async () => {
      if (authMode === 'forgot') {
        await requestPasswordReset(email.trim());
        setAuthMode('forgot-confirm');
      } else if (authMode === 'forgot-confirm') {
        await confirmPasswordReset(resetToken.trim(), password);
        setResetToken('');
        setPassword('');
        setAuthMode('login');
        await refreshAccount();
      } else {
        await (authMode === 'register' ? register : login)(email.trim(), password);
        setPassword('');
        await refreshAccount();
      }
    }, okMsg);
  }, [authMode, email, password, resetToken, refreshAccount, run]);

  const subscribe = useCallback(
    (tier: BillingTier, interval: 'monthly' | 'annual' | 'onetime') => {
      const priceId = tier[interval];
      if (!priceId) return;
      void run(async () => {
        const session = await createCheckoutSession({
          priceId,
          email: email.trim() || undefined,
          mode: interval === 'onetime' ? 'payment' : 'subscription',
        });
        window.location.href = session.url;
      });
    },
    [email, run],
  );

  const openPortal = useCallback(() => {
    void run(async () => {
      const res = await createPortalSession({ email: email.trim() || undefined });
      window.location.href = res.url;
    });
  }, [email, run]);

  const lookupStatus = useCallback(() => {
    if (!email.trim()) {
      setPhase('error');
      setMessage('Enter your billing email first.');
      return;
    }
    loadStatus(email.trim());
  }, [email, loadStatus]);

  if (!billingOpen) return null;

  const busy = phase === 'working';
  const portalAvailable = !!config?.portalEnabled;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 px-4 pt-[8vh] backdrop-blur-sm" onMouseDown={close}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Plans & billing"
      >
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <CreditCard className="size-4 text-primary" />
            <span className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">Account &amp; billing</span>
          </div>
          <button onClick={close} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Close (Esc)">
            <X className="size-3.5" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-4 font-mono text-xs">
          {/* ── Auth panel ── */}
          {user ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-1.5 rounded border border-border bg-background px-2 py-1.5">
              <span className="text-type-xs text-foreground">
                <span className="text-muted-foreground">signed in · </span>{user.email}
              </span>
              <button
                onClick={() => { void run(async () => { await useAccountStore.getState().signOut(); }); }}
                disabled={busy}
                className="rounded border border-border px-2 py-0.5 text-type-2xs uppercase tracking-wider text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Sign out
              </button>
            </div>
          ) : (
            <form
              onSubmit={(e) => { e.preventDefault(); submitAuth(); }}
              className="mb-3 rounded border border-border bg-background p-2.5"
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-type-2xs uppercase tracking-widest text-muted-foreground">
                  {authMode === 'register' ? 'Create account' : authMode === 'login' ? 'Sign in' : 'Reset password'}
                </span>
                {authMode.startsWith('forgot') ? (
                  <button
                    type="button"
                    onClick={() => setAuthMode('login')}
                    className="text-type-2xs text-primary underline-offset-2 hover:underline"
                  >
                    back to sign in
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAuthMode(authMode === 'register' ? 'login' : 'register')}
                      className="text-type-2xs text-primary underline-offset-2 hover:underline"
                    >
                      {authMode === 'register' ? 'have an account? sign in' : 'new here? register'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuthMode('forgot')}
                      className="text-type-2xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                      forgot password?
                    </button>
                  </div>
                )}
              </div>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                type="email"
                autoComplete="email"
                disabled={busy}
                required
                className="mb-1.5 w-full rounded border border-border bg-card px-2 py-1.5 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
              />
              {authMode === 'forgot-confirm' && (
                <input
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  placeholder="reset code (from server console)"
                  type="text"
                  disabled={busy}
                  required
                  className="mb-1.5 w-full rounded border border-border bg-card px-2 py-1.5 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
                />
              )}
              {authMode !== 'forgot' && (
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    authMode === 'register'
                      ? 'password (8+ chars)'
                      : authMode === 'forgot-confirm'
                        ? 'new password (8+ chars)'
                        : 'password'
                  }
                  type="password"
                  autoComplete={
                    authMode === 'register' ? 'new-password' : authMode === 'forgot-confirm' ? 'new-password' : 'current-password'
                  }
                  disabled={busy}
                  required
                  minLength={authMode === 'login' ? 1 : 8}
                  className="w-full rounded border border-border bg-card px-2 py-1.5 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
                />
              )}
              <button
                type="submit"
                disabled={busy || !email.trim() || (authMode !== 'forgot' && (!password || (authMode === 'forgot-confirm' && !resetToken.trim())))}
                className="mt-1.5 w-full rounded border border-primary/40 bg-secondary py-1 transition-colors hover:border-primary hover:bg-accent disabled:opacity-50"
              >
                {authMode === 'register'
                  ? 'Register & continue'
                  : authMode === 'login'
                    ? 'Sign in'
                    : authMode === 'forgot'
                      ? 'Request reset code'
                      : 'Set new password'}
              </button>
              {authMode === 'forgot' && (
                <p className="mt-1 text-type-2xs leading-relaxed text-muted-foreground">
                  This deployment has no email delivery — the reset code is printed in the server console and must be handed to you by the operator. It is single-use and expires in 1 hour.
                </p>
              )}
              <p className="mt-1 text-type-2xs leading-relaxed text-muted-foreground">
                An account links your subscription to desk access. Subscribe first and register later works too — same billing email matches automatically.
              </p>
            </form>
          )}

          {!config && phase !== 'error' && (
            <p className="py-6 text-center text-muted-foreground">Loading plans…</p>
          )}

          {config && !config.enabled && (
            <p className="rounded border border-border bg-muted px-2 py-2 leading-relaxed text-muted-foreground">
              Billing is not configured on this deployment yet. Set <code className="text-primary">STRIPE_SECRET_KEY</code> in
              server <code>.env</code> and map tier prices via <code className="text-primary">STRIPE_PRICE_*_MONTHLY / ANNUAL / ONETIME</code>.
            </p>
          )}

          {config?.enabled && (
            <>
              {!user && (
                <div className="mb-3">
                  <label className="block">
                    <span className="text-type-2xs uppercase tracking-widest text-muted-foreground">Billing email (optional)</span>
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      type="email"
                      autoComplete="email"
                      disabled={busy}
                      className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary/50"
                    />
                  </label>
                </div>
              )}

              <div className="grid gap-2">
                {config.tiers.map((tier) => (
                  <div key={tier.key} className="rounded border border-border bg-background p-3">
                    <div className="mb-2 flex items-baseline justify-between">
                      <span className="text-sm font-semibold tracking-wide">{tier.label}</span>
                      <span className="text-type-2xs uppercase tracking-widest text-muted-foreground">{tier.key}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(['monthly', 'annual', 'onetime'] as const).map((iv) =>
                        tier[iv] ? (
                          <button
                            key={iv}
                            onClick={() => subscribe(tier, iv)}
                            disabled={busy}
                            className="rounded border border-primary/40 bg-secondary px-2.5 py-1 transition-colors hover:border-primary hover:bg-accent disabled:opacity-50"
                          >
                            Subscribe · {INTERVAL_LABEL[iv] ? `${iv}${INTERVAL_LABEL[iv]}` : iv}
                          </button>
                        ) : null,
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
                <button
                  onClick={openPortal}
                  disabled={busy || !portalAvailable || !user}
                  className="flex items-center gap-1 rounded border border-border bg-secondary px-2.5 py-1 transition-colors hover:bg-accent disabled:opacity-40"
                  title={
                    !portalAvailable
                      ? 'Enable the Customer Portal in the Stripe Dashboard first'
                      : !user
                        ? 'Sign in first — portal access is limited to your own billing profile'
                        : 'Manage subscription, invoices, payment method'
                  }
                >
                  Manage subscription <ExternalLink className="size-3" />
                </button>
                {!user && (
                  <button
                    onClick={lookupStatus}
                    disabled={busy}
                    className="rounded border border-border px-2.5 py-1 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    Check status by email
                  </button>
                )}
              </div>

              {status && status.records.length > 0 && (
                <div className="mt-3 rounded border border-border bg-background p-2 text-type-xs">
                  {status.records.map((r) => (
                    <div key={r.customerId} className="flex flex-wrap items-center justify-between gap-1 py-0.5">
                      <span className={r.status === 'active' || r.status === 'trialing' || r.status === 'paid' ? 'text-up' : 'text-muted-foreground'}>
                        {r.status}{r.cancelAtPeriodEnd ? ' · cancels at period end' : ''}
                        {r.currentPeriodEnd ? ` · renews ${new Date(r.currentPeriodEnd).toLocaleDateString()}` : ''}
                      </span>
                      <span className="text-muted-foreground">{r.priceId}</span>
                    </div>
                  ))}
                </div>
              )}
              {status && status.records.length === 0 && status.active && (
                <p className="mt-3 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-emerald-300">
                  Active subscription found for that email. Sign in with it to see full billing details.
                </p>
              )}
            </>
          )}

          {(phase === 'error' || phase === 'done') && message && (
            <p
              className={`mt-3 rounded px-2 py-1.5 ${
                phase === 'error'
                  ? 'border border-destructive/40 bg-destructive/10 text-red-300'
                  : 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              }`}
            >
              {message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
