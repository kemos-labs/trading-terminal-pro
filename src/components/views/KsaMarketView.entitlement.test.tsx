/**
 * KSA entitlement-denied branch (A-tranche gate support).
 * A 402 subscription_required board must render an explicit denial panel —
 * never a generic error, never board numbers, never account identifiers.
 * (The shell paywall covers desk navigation; this covers direct renders.
 * Mocked fetch: deterministic state, not live evidence.)
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { KsaMarketView } from './KsaMarketView';

const REAL_FETCH = global.fetch;

afterEach(() => {
  global.fetch = REAL_FETCH;
});

describe('KsaMarketView entitlement denial', () => {
  it('renders Subscription required on 402 with no data leak', async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'subscription_required', gatedDesks: ['ksa'] }), {
        status: 402,
        headers: { 'content-type': 'application/json' },
      }),
    );
    render(<KsaMarketView />);
    await waitFor(() => expect(screen.getByText('Subscription required')).toBeInTheDocument());
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/12,150/);
    expect(body).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(body).not.toMatch(/Unlock this desk/);
    await act(async () => {});
  });
});
