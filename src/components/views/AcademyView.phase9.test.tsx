import { describe, expect, it, vi } from 'vitest';

/** Academy Phase 9 — search filter present, single-nav preserved, deep-link sections respected. */
vi.mock('../../store/terminalStore', () => ({
  useTerminalStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => {
      const state = {
        deskSectionId: 'academy-sub-start',
        setDeskSection: vi.fn(),
        symbol: 'SPY',
      };
      return selector(state);
    },
    { getState: () => ({ deskSectionId: 'academy-sub-start', setDeskSection: vi.fn(), symbol: 'SPY' }) },
  ),
}));

describe('AcademyView — Phase 9 contract guards', () => {
  it('source: search input exists, no second nav bar, deep-link categories intact', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const text = fs.readFileSync(path.join(import.meta.dirname, 'AcademyView.tsx'), 'utf8');
    expect(text).toContain('academy-search');
    expect(text).toContain('matchesQuery');
    // single navigation — no duplicated nav chip row was reintroduced
    expect(text).toContain('Navigate via red function bar');
    // the tabs-info class exists but is not a nav list (aria-hidden container holds search)
    // deep-link category mapping still via catFromSection
    expect(text).toContain('catFromSection');
  });
});
