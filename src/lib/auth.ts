/**
 * Auth client — session cookie based (vt_session, HttpOnly, set by server).
 * All state lives in accountStore; these are thin fetch wrappers.
 */
import type { ActiveTab } from './options/types';

export interface AccountUser {
  email: string;
}

export interface GateInfo {
  enabled: boolean;
  gatedDesks: ActiveTab[];
  entitled: boolean;
}

export interface MeResponse {
  user: AccountUser | null;
  gate: GateInfo | null;
  billingConfigured: boolean;
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  return body as T;
}

export async function fetchMe(): Promise<MeResponse> {
  return json(await fetch('/api/auth/me'));
}

export async function login(email: string, password: string): Promise<{ user: AccountUser }> {
  return json(
    await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  );
}

export async function register(email: string, password: string): Promise<{ user: AccountUser }> {
  return json(
    await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
  );
}

export async function logout(): Promise<void> {
  await json(await fetch('/api/auth/logout', { method: 'POST' }));
}

export async function requestPasswordReset(email: string): Promise<{ ok: boolean; message?: string }> {
  return json(
    await fetch('/api/auth/reset-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }),
  );
}

export async function confirmPasswordReset(token: string, password: string): Promise<{ user: AccountUser }> {
  return json(
    await fetch('/api/auth/reset-confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    }),
  );
}
