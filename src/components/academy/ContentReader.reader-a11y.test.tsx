import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ContentReader } from './ContentReader';

describe('ContentReader keyboard scroll region', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function renderReader(title = 'Reading Plan') {
    vi.spyOn(window, 'fetch').mockImplementation(async () =>
      ({ ok: true, text: async () => `# ${title}\n\nBody words here.` }) as never,
    );
    const onClose = vi.fn();
    await act(async () => {
      render(
        <ContentReader docPath="/docs/academy/trading-reading-plan.md" title={title} onClose={onClose} />,
      );
    });
    await screen.findByText(/Body words here/);
    return { onClose };
  }

  it('scrolling reading region is keyboard-focusable with an accessible name; article semantics preserved', async () => {
    await renderReader();
    const article = screen.getByRole('article');
    expect(article.getAttribute('data-doc')).toBe('/docs/academy/trading-reading-plan.md');
    const region = screen.getByRole('region', { name: /Reading Plan — essay body/ });
    expect(region.className).toContain('academy-post-scroll');
    expect(region.tabIndex).toBe(0);
    // Tab focus enters the scrolling region (single tab stop, no nested trap).
    region.focus();
    expect(document.activeElement).toBe(region);
  });

  it('scroll keys stay in the region (global shortcuts do not swallow ArrowDown/PageDown)', async () => {
    await renderReader();
    const region = screen.getByRole('region', { name: /Reading Plan — essay body/ });
    const seen: string[] = [];
    const onWindow = (e: Event) => {
      if ((e as KeyboardEvent).key === 'ArrowDown' || (e as KeyboardEvent).key === 'PageDown') {
        seen.push((e as KeyboardEvent).key);
      }
    };
    window.addEventListener('keydown', onWindow);
    fireEvent.keyDown(region, { key: 'ArrowDown' });
    fireEvent.keyDown(region, { key: 'PageDown' });
    window.removeEventListener('keydown', onWindow);
    // Stopped at the region boundary: the global layer never sees them, and
    // default is NOT prevented so the browser scrolls natively.
    expect(seen).toEqual([]);
  });

  it('Esc closes the reader (back/close path preserved)', async () => {
    const { onClose } = await renderReader();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
