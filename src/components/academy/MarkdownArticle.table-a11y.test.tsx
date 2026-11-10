import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarkdownArticle } from './MarkdownArticle';
describe('MarkdownArticle tables', () => {
  it('wrap is keyboard-focusable with accessible name', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |';
    const { container } = render(<MarkdownArticle markdown={md} docPath="/docs/academy/x.md" />);
    const wrap = container.querySelector('.academy-md-table-wrap') as HTMLElement;
    expect(wrap).toBeTruthy();
    expect(wrap.tabIndex).toBe(0);
    expect(wrap.getAttribute('role')).toBe('region');
    expect((wrap.getAttribute('aria-label') || '').length).toBeGreaterThan(5);
  });
});
