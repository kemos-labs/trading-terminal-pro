/**
 * OPRA client transport stub (PR-10).
 * Server owns entitlement; browser only hits `/api/opra/*`.
 * No delta-apply / ChainDiff — snapshot path only when vendor is live.
 */

export type OpraStatus = {
  enabled: boolean;
  vendor: string;
  mode: string;
  ready: boolean;
  note: string;
  timestamp: number;
};

export type OpraChainResponse =
  | { error: string; symbol: string; hint?: string; vendor?: string; message?: string; mode?: string }
  | { symbol: string; asOfMs: number; quotes: unknown[] };

export async function fetchOpraStatus(signal?: AbortSignal): Promise<OpraStatus | null> {
  try {
    // route-parity: GET /api/opra/status
    const res = await fetch('/api/opra/status', { signal });
    if (!res.ok) return null;
    return (await res.json()) as OpraStatus;
  } catch {
    return null;
  }
}

/**
 * Attempt OPRA chain snapshot via server proxy.
 * Expect 503 until OPRA_ENABLED + real vendor adapter are configured.
 */
export async function fetchOpraChainSnapshot(
  symbol: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; body: OpraChainResponse | null }> {
  try {
    // route-parity: GET /api/opra/chain/:symbol
    const res = await fetch(`/api/opra/chain/${encodeURIComponent(symbol)}`, { signal });
    const body = (await res.json().catch(() => null)) as OpraChainResponse | null;
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}
