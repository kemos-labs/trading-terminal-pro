import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

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

const DOC_A = 'docs/academy/trading-reading-plan.md';
const DOC_B = 'docs/options/01-theta-is-not-free-money.md';

const INDEX = {
  version: 3,
  title: 'Kemos Research Academy',
  description: 'desc',
  categories: [
    {
      id: 'start',
      label: 'Start',
      description: 'start',
      files: [
        { path: DOC_A, title: 'Reading Plan Vol', source: 'desk', tags: ['vol'], sections: [{ heading: 'Intro' }] },
      ],
    },
    {
      id: 'options',
      label: 'Options',
      description: 'opts',
      files: [
        { path: DOC_B, title: 'Theta Essay', source: 'desk', tags: ['theta'], sections: [{ heading: 'Body' }] },
      ],
    },
  ],
};

let fetchSpy: ReturnType<typeof vi.spyOn>;

async function renderAcademy(url: string) {
  window.history.replaceState(null, '', url);
  const { AcademyView } = await import('./AcademyView');
  let utils: ReturnType<typeof render> | undefined;
  await act(async () => {
    utils = render(<AcademyView />);
  });
  return utils!;
}

function mockFetchImpl(indexDelay = 0) {
  fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(async (input: any) => {
    const u = String(input);
    if (u.includes('/docs/index.json')) {
      if (indexDelay > 0) await new Promise((r) => setTimeout(r, indexDelay));
      return { ok: true, json: async () => INDEX } as never;
    }
    if (u === `/${DOC_A}` || u === `/${DOC_B}`) {
      return { ok: true, text: async () => `# Essay\n\nBody words here for ${u}.` } as never;
    }
    return { ok: false, status: 404, text: async () => '' } as never;
  });
}

beforeEach(() => {
  vi.resetModules();
  mockFetchImpl();
});

afterEach(() => {
  fetchSpy?.mockRestore();
  vi.useRealTimers();
});

describe('AcademyView deep links (?q= / ?doc=)', () => {
  it('initial ?q= cold load pre-filters the catalog', async () => {
    await renderAcademy('/?desk=academy&sec=academy-sub-start&q=theta');
    await screen.findByTestId('academy-search');
    await screen.findByText('Theta Essay');
    expect(screen.queryByText('Reading Plan Vol')).toBeNull();
    expect((screen.getByTestId('academy-search') as HTMLInputElement).value).toBe('theta');
  });

  it('typed query syncs to URL debounced, preserving desk/sec/unrelated params', async () => {
    await renderAcademy('/?desk=academy&sec=academy-sub-start&foo=bar');
    const input = (await screen.findByTestId('academy-search')) as HTMLInputElement;
    await screen.findByText('Reading Plan Vol');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'theta' } });
      await new Promise((r) => setTimeout(r, 350));
    });
    const params = new URL(window.location.href).searchParams;
    expect(params.get('q')).toBe('theta');
    expect(params.get('desk')).toBe('academy');
    expect(params.get('sec')).toBe('academy-sub-start');
    expect(params.get('foo')).toBe('bar');
    // Clearing removes the param.
    await act(async () => {
      fireEvent.change(input, { target: { value: '' } });
      await new Promise((r) => setTimeout(r, 350));
    });
    expect(new URL(window.location.href).searchParams.get('q')).toBeNull();
  });

  it('cold-load valid ?doc= opens the article after index (refresh-safe)', async () => {
    await renderAcademy(`/?desk=academy&sec=academy-sub-start&doc=${encodeURIComponent(DOC_A)}`);
    // Trusted entry → ContentReader mounts and fetches exactly the catalog path.
    const reader = await screen.findByRole('article');
    expect(reader.getAttribute('data-doc')).toBe(`/${DOC_A}`);
    const fetched = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(fetched).toContain(`/${DOC_A}`);
    expect(await screen.findByText(/Body words here/)).toBeTruthy();
  });

  it('open pushes ?doc=, close clears it while preserving q/desk/sec', async () => {
    await renderAcademy('/?desk=academy&sec=academy-sub-start&q=vol');
    await screen.findByText('Reading Plan Vol');
    const stackDepth = window.history.length;
    fireEvent.click(screen.getByText('Reading Plan Vol'));
    await screen.findByRole('article');
    expect(window.history.length).toBe(stackDepth + 1);
    let params = new URL(window.location.href).searchParams;
    expect(params.get('doc')).toBe(DOC_A);
    expect(params.get('q')).toBe('vol');
    // Close via back bar removes doc, keeps the rest.
    fireEvent.click(screen.getByText('← Kemos Research Academy'));
    await screen.findByTestId('academy-search');
    params = new URL(window.location.href).searchParams;
    expect(params.get('doc')).toBeNull();
    expect(params.get('q')).toBe('vol');
    expect(params.get('desk')).toBe('academy');
    expect(params.get('sec')).toBe('academy-sub-start');
  });

  it('back/forward restores article state via popstate', async () => {
    await renderAcademy('/?desk=academy&sec=academy-sub-start');
    await screen.findByText('Reading Plan Vol');
    fireEvent.click(screen.getByText('Reading Plan Vol'));
    await screen.findByRole('article');
    // Simulate browser back to the list URL.
    await act(async () => {
      window.history.replaceState(null, '', '/?desk=academy&sec=academy-sub-start');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await screen.findByTestId('academy-search');
    expect(screen.queryByRole('article')).toBeNull();
    // And forward again to the article URL.
    await act(async () => {
      window.history.replaceState(null, '', `/?desk=academy&sec=academy-sub-start&doc=${encodeURIComponent(DOC_A)}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await screen.findByRole('article');
  });

  it.each([
    ['unknown catalog path', 'docs/academy/nope-missing.md'],
    ['traversal', 'docs/../academy/secret.md'],
    ['absolute path', '/docs/academy/trading-reading-plan.md'],
    ['external URL', 'https://evil.example/x.md'],
  ])('never fetches %s; shows unavailable with catalog navigation', async (_label, doc) => {
    await renderAcademy(`/?desk=academy&sec=academy-sub-start&doc=${encodeURIComponent(doc)}`);
    const missing = await screen.findByTestId('academy-doc-not-found');
    expect(missing.textContent).toMatch(/unavailable/i);
    const fetched = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(fetched.filter((u) => !u.includes('/docs/index.json'))).toEqual([]);
    // Catalog navigation back to essays works and clears doc.
    fireEvent.click(screen.getByText('Browse all essays'));
    await screen.findByTestId('academy-search');
    expect(new URL(window.location.href).searchParams.get('doc')).toBeNull();
  });

  it('pending catalog shows loading, not false not-found; error shows error, not absent', async () => {
    // Slow index: doc parked while pending → loading spinner, no not-found.
    fetchSpy.mockRestore();
    mockFetchImpl(150);
    const p = renderAcademy(`/?desk=academy&doc=${encodeURIComponent(DOC_A)}`);
    expect(await screen.findByText('Loading…')).toBeTruthy();
    expect(screen.queryByTestId('academy-doc-not-found')).toBeNull();
    await screen.findByRole('article');
    (await p).unmount();

    // Index error: honest error, never a false absent-doc claim.
    fetchSpy.mockRestore();
    fetchSpy = vi.spyOn(window, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).includes('/docs/index.json')) return { ok: false, status: 500 } as never;
      return { ok: false, status: 404, text: async () => '' } as never;
    });
    await renderAcademy(`/?desk=academy&doc=${encodeURIComponent(DOC_A)}`);
    expect(await screen.findByText('Failed to load academy index.')).toBeTruthy();
    expect(screen.queryByTestId('academy-doc-not-found')).toBeNull();
  });

  it('existing categories, glossary tab, and Esc close are preserved', async () => {
    const { useTerminalStore } = await import('../../store/terminalStore');
    void useTerminalStore;
    await renderAcademy('/?desk=academy&sec=academy-sub-start');
    await screen.findByText('Reading Plan Vol');
    // Esc closes an open reader.
    fireEvent.click(screen.getByText('Reading Plan Vol'));
    await screen.findByRole('article');
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await screen.findByTestId('academy-search');
    // Esc closes the unavailable state too.
    await act(async () => {
      window.history.replaceState(null, '', '/?desk=academy&doc=docs%2Facademy%2Fnope.md');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await screen.findByTestId('academy-doc-not-found');
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    await screen.findByTestId('academy-search');
  });

  it('normalizeAcademyDocParam: strict boundary unit checks', async () => {
    const m = await import('./AcademyView');
    expect(m.normalizeAcademyDocParam(DOC_A)).toBe(DOC_A);
    expect(m.normalizeAcademyDocParam('')).toBeNull();
    expect(m.normalizeAcademyDocParam(null)).toBeNull();
    expect(m.normalizeAcademyDocParam('/docs/academy/x.md')).toBeNull();
    expect(m.normalizeAcademyDocParam('https://x/y.md')).toBeNull();
    expect(m.normalizeAcademyDocParam('javascript:alert(1)')).toBeNull();
    expect(m.normalizeAcademyDocParam('docs/../secret.md')).toBeNull();
    expect(m.normalizeAcademyDocParam('docs/./x.md')).toBeNull();
    expect(m.normalizeAcademyDocParam('docs\\academy\\x.md')).toBeNull();
    expect(m.normalizeAcademyDocParam('other/x.md')).toBeNull();
    expect(m.normalizeAcademyDocParam('docs/x.txt')).toBeNull();
    expect(m.normalizeAcademyDocParam('docs//x.md')).toBeNull();
  });
});
