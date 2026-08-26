# Agent rules — trading-terminal-pro

## Secrets (always, no asking)

When the user pastes or mentions an API key, token, password, or credential:

1. **Write it only** to local server `.env` (or the correct server env file). Never into source, docs, `.env.example`, commits, PR text, or chat echoes.
2. **Never re-print** the secret value in replies (redact as `***`).
3. **Confirm** `.env` is gitignored and prefer `chmod 600 .env`.
4. **Restart** guidance only (“restart Node”) — do not dump env contents.
5. **Provider keys stay server-side** — browser/Vite must never receive `SAHMK_*`, Finnhub, AV, FMP, FlashAlpha, etc.
6. **Rotation:** if a live key was pasted into chat/logs, say they should rotate on the provider portal; agents cannot rotate SAHMK without dashboard login.
7. Before any commit that might include secrets, run `scripts/check-secrets.sh` (also wired in `.git/hooks/pre-commit`).

### Current market keys

| Env | Purpose | Where |
|-----|---------|--------|
| `SAHMK_API_KEY` | Tadawul / KSA desk | Server `.env` only · header `X-API-Key` |

See `docs/engineering/KSA_DATA_PROVIDERS.md` and `.env.example` (placeholders only).

## Stripe Billing & Auth — current state (built, awaiting keys)

Status and continuation instructions live in **`docs/engineering/BILLING_HANDOFF.md`**
(architecture: `docs/engineering/BILLING.md`). Summary:

- Built end-to-end: Stripe Checkout/Portal/webhooks (`api/stripeBilling.js`), email+password
  accounts with signed-cookie sessions (`api/authStore.js`, `api/authRoutes.js`), desk paywall
  gating KSA by default (`requireDeskAccess()` in `server.js`, client `DeskViewGate`),
  account+billing UI (`src/components/terminal/BillingDialog.tsx`, `src/store/accountStore.ts`).
- All endpoints fail closed when `STRIPE_SECRET_KEY` is absent; app runs fully open until keys land.
- **Connect decision: NOT used** (operational SaaS, no third-party payouts). Do not add Connect
  without revisiting the decision log in `docs/engineering/BILLING.md`.
- Pending (human + next agent): Dashboard Products/Prices → env price mappings, test-mode
  restricted key into `.env`, webhook forwarding, Customer Portal activation.
- Never pass `payment_method_types` to any Stripe call (dynamic payment methods). The webhook
  handler requires RAW body — its parser is scoped inside `registerStripeBilling`; don't globalize it.
- Working tree may contain pre-existing modifications unrelated to billing — review `git status`
  before committing.
