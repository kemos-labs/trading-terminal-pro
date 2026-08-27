import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// No feature-flag mock: test the default production build (V2 is the product).
import { CryptoShell, WORKFLOWS } from './CryptoShell';
import { CRYPTO_SECTIONS } from '../../../config/deskSections';

describe('CryptoShell V2', () => {
  beforeEach(() => {
    // Reset URL
    window.history.pushState({}, '', '/?desk=crypto&view=overview&asset=BTC&venue=deribit');
  });

  it('exposes exactly six workflows', () => {
    expect(WORKFLOWS).toHaveLength(6);
    expect(CRYPTO_SECTIONS).toHaveLength(6);
    expect(WORKFLOWS.map(w => w.id)).toEqual(['overview','volatility','positioning','flow','carry','trade-risk']);
  });

  it('renders six workflow tabs with ARIA roles', () => {
    render(<CryptoShell />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(6);
    expect(screen.getByRole('tab', { name: /Overview/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Volatility/ })).toBeInTheDocument();
  });

  it('shows global asset/venue strip and provenance', () => {
    render(<CryptoShell />);
    expect(screen.getByText(/VOLATERM/)).toBeInTheDocument();
    expect(screen.getByText(/BTC.*deribit/i)).toBeInTheDocument();
    expect(screen.getByText(/Source: Deribit/)).toBeInTheDocument();
  });

  it('does not show static Observed/live badges (data-driven only)', () => {
    render(<CryptoShell />);
    // No static 'live' label in banner — freshness is data-driven per workflow
    expect(screen.queryByText(/^live$/)).toBeNull();
    // No static 'Observed' badge in shell footer — workflows render their own
    expect(screen.queryByText(/^Observed$/)).toBeNull();
  });

  it('default production build renders all six workflows without flags', () => {
    // No VITE_CRYPTO_V2 env, no flag mock — this is the real default build
    render(<CryptoShell />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(6);
    expect(WORKFLOWS.map(w => w.id)).toEqual(['overview','volatility','positioning','flow','carry','trade-risk']);
  });

  it('URL state maps legacy page param to workflow', () => {
    window.history.pushState({}, '', '/?crypto=BTC&page=flow');
    render(<CryptoShell />);
    // Should default to flow workflow when legacy page=flow
    // Our getWorkflowFromUrl maps flow -> flow
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-label', expect.stringMatching(/Flow/));
  });
});
