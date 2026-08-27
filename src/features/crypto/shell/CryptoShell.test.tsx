import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock feature flag to force V2 on
vi.mock('../../../config/featureFlags', async () => {
  const actual = await vi.importActual('../../../config/featureFlags') as any;
  return { ...actual, CRYPTO_V2: true };
});

import { CryptoShell, WORKFLOWS } from './CryptoShell';
import { CRYPTO_V2_SECTIONS } from '../../../config/deskSections';

describe('CryptoShell V2', () => {
  beforeEach(() => {
    // Reset URL
    window.history.pushState({}, '', '/?desk=crypto&view=overview&asset=BTC&venue=deribit');
  });

  it('exposes exactly six workflows', () => {
    expect(WORKFLOWS).toHaveLength(6);
    expect(CRYPTO_V2_SECTIONS).toHaveLength(6);
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

  it('URL state maps legacy page param to workflow', () => {
    window.history.pushState({}, '', '/?crypto=BTC&page=flow');
    render(<CryptoShell />);
    // Should default to flow workflow when legacy page=flow
    // Our getWorkflowFromUrl maps flow -> flow
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-label', expect.stringMatching(/Flow/));
  });
});
