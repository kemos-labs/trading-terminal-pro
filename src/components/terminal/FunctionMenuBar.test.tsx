import * as React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { FunctionMenuBar } from './FunctionMenuBar';
import { TABS } from './tabs';
import { useTerminalStore } from '../../store/terminalStore';

function resetStore() {
  useTerminalStore.setState({ activeTab: 'vol' as any, deskSectionId: 'vol-sub-surface' });
}

describe('FunctionMenuBar mobile regression', () => {
  beforeEach(resetStore);
  it('renders all eight desk buttons and preserves dropdown + pinned search without clipping', () => {
    const { container, getByRole } = render(<FunctionMenuBar />);
    const toolbar = getByRole('toolbar');
    // All eight desks present (labels from TABS)
    for (const tab of TABS) {
      expect(toolbar.textContent).toContain(tab.label);
    }
    // Ensure KSA / Academy specifically not clipped (regression desks)
    expect(toolbar.textContent).toContain('KSA');
    expect(toolbar.textContent).toContain('Academy');

    // Pinned search / CommandLine present
    expect(container.querySelector('[aria-label="Command line"]')).toBeTruthy();

    // Outer bar: overflow-visible on desktop, scrollable at <=560px (thin scrollbar affordance)
    const cls = toolbar.className;
    expect(cls).toContain('overflow-visible');
    expect(cls).toContain('max-[560px]:overflow-x-auto');
    expect(cls).toContain('max-[560px]:[scrollbar-width:thin]');

    expect(cls).toContain('max-[560px]:touch-pan-x');

    // Trigger hover to open desktop dropdown and verify it carries the mobile-hidden contract
    const volBtn = toolbar.querySelector('button[title="Vol (1)"]');
    expect(volBtn).toBeTruthy();
    fireEvent.mouseEnter(volBtn!.parentElement as Element);
    // After hover, dropdown should be in DOM with max-[560px]:hidden (desktop only)
    const afterHtml = container.innerHTML;
    expect(afterHtml).toContain('max-[560px]:hidden');
  });
});

describe('FunctionMenuBar a11y disclosure', () => {
  beforeEach(resetStore);

  it('exposes aria-haspopup/controls/expanded and menu/menuitem semantics (aria-controls only when open)', () => {
    const { container, getByRole } = render(<FunctionMenuBar />);
    const toolbar = getByRole('toolbar');
    const volBtn = toolbar.querySelector('button[title="Vol (1)"]') as HTMLButtonElement;
    expect(volBtn.getAttribute('aria-haspopup')).toBe('menu');
    // F3: aria-controls must not reference absent ids when closed
    expect(volBtn.getAttribute('aria-controls')).toBeNull();
    expect(volBtn.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(volBtn);
    expect(volBtn.getAttribute('aria-expanded')).toBe('true');
    // When open, controls references the desktop menu id (and mobile id when position resolved)
    expect(volBtn.getAttribute('aria-controls')).toContain('desk-menu-vol');

    const menu = container.querySelector('#desk-menu-vol') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.getAttribute('aria-labelledby')).toBe('desk-btn-vol');
    const items = menu.querySelectorAll('[role="menuitem"]');
    expect(items.length).toBeGreaterThan(0);
  });

  it('pointer/touch toggle for desks with babies (click opens, second click closes)', () => {
    const { container } = render(<FunctionMenuBar />);
    const volBtn = container.querySelector('button[title="Vol (1)"]') as HTMLButtonElement;
    expect(container.querySelector('#desk-menu-vol')).toBeFalsy();
    fireEvent.click(volBtn);
    expect(container.querySelector('#desk-menu-vol')).toBeTruthy();
    fireEvent.click(volBtn);
    expect(container.querySelector('#desk-menu-vol')).toBeFalsy();
  });

  it('keyboard Enter toggles and Space toggles, ArrowDown opens and focuses first menuitem', async () => {
    const { container } = render(<FunctionMenuBar />);
    const volBtn = container.querySelector('button[title="Vol (1)"]') as HTMLButtonElement;
    volBtn.focus();
    expect(document.activeElement).toBe(volBtn);

    fireEvent.keyDown(volBtn, { key: 'Enter' });
    // after Enter, menu should open
    expect(container.querySelector('#desk-menu-vol')).toBeTruthy();

    // Escape should close and return focus
    fireEvent.keyDown(volBtn, { key: 'Escape' });
    // global Escape listener closes via document; simulate on document
    fireEvent.keyDown(document, { key: 'Escape' });
    // allow rAF focus return
    await new Promise((r) => setTimeout(r, 20));
    // menu closed
    expect(container.querySelector('#desk-menu-vol')).toBeFalsy();

    // ArrowDown opens and focuses first item
    fireEvent.keyDown(volBtn, { key: 'ArrowDown' });
    await new Promise((r) => setTimeout(r, 20));
    const menu = container.querySelector('#desk-menu-vol');
    expect(menu).toBeTruthy();
    const firstItem = menu?.querySelector('[role="menuitem"]') as HTMLElement;
    expect(document.activeElement).toBe(firstItem);

    // Space on button when open should close
    volBtn.focus();
    fireEvent.keyDown(volBtn, { key: ' ' });
    expect(container.querySelector('#desk-menu-vol')).toBeFalsy();
  });

  it('Escape inside menu closes and returns focus to desk button; outside mousedown dismisses', async () => {
    const { container } = render(<FunctionMenuBar />);
    const volBtn = container.querySelector('button[title="Vol (1)"]') as HTMLButtonElement;
    fireEvent.click(volBtn);
    await new Promise((r) => setTimeout(r, 20));
    const menu = container.querySelector('#desk-menu-vol') as HTMLElement;
    const firstItem = menu.querySelector('[role="menuitem"]') as HTMLElement;
    firstItem.focus();
    expect(document.activeElement).toBe(firstItem);

    fireEvent.keyDown(firstItem, { key: 'Escape' });
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('#desk-menu-vol')).toBeFalsy();
    expect(document.activeElement).toBe(volBtn);

    // Reopen and test outside dismissal
    fireEvent.click(volBtn);
    expect(container.querySelector('#desk-menu-vol')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(container.querySelector('#desk-menu-vol')).toBeFalsy();
  });

  it('ArrowDown/ArrowUp navigate menuitems and GO behavior unchanged', async () => {
    const { container } = render(<FunctionMenuBar />);
    const volBtn = container.querySelector('button[title="Vol (1)"]') as HTMLButtonElement;
    fireEvent.keyDown(volBtn, { key: 'ArrowDown' });
    await new Promise((r) => setTimeout(r, 20));
    const menu = container.querySelector('#desk-menu-vol') as HTMLElement;
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]')) as HTMLElement[];
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[0]);

    // CommandLine GO still present and unchanged
    expect(container.querySelector('[aria-label="Command line"]')).toBeTruthy();
    expect(container.querySelector('[aria-label="GO"]')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Regression-style tests for independent review blockers F1–F3.
// Note: jsdom does not apply CSS media queries (max-[560px]:hidden is not evaluated
// and pointerType emulation is synthetic). These tests reproduce the logical fixes
// (touch-ignored hover, mobile focus routing, scoped aria-controls/Escape) without
// claiming to prove viewport media behavior — that requires real-browser Playwright
// at 390x844 / 1440x900.
// ---------------------------------------------------------------------------
describe('FunctionMenuBar F1–F3 regression', () => {
  beforeEach(resetStore);

  it('F1: hover-then-click does not close at touch pointer (pointerenter touch ignored)', async () => {
    const { container } = render(<FunctionMenuBar />);
    const toolbar = container.querySelector('[role="toolbar"]') as HTMLElement;
    const volBtn = toolbar.querySelector('button[title="Vol (1)"]') as HTMLButtonElement;
    const wrapper = volBtn.parentElement as HTMLElement;
    // Simulate Chromium tap trace: pointerenter(touch) before click. With fix, touch pointerenter is ignored.
    const mkPointer = (type: string, pointerType: string) => {
      const ev = new Event(type, { bubbles: true } as any);
      Object.defineProperty(ev, 'pointerType', { value: pointerType });
      return ev;
    };
    wrapper.dispatchEvent(mkPointer('pointerenter', 'touch'));
    expect(container.querySelector('#desk-menu-vol')).toBeFalsy();
    fireEvent.click(volBtn);
    expect(container.querySelector('#desk-menu-vol')).toBeTruthy();
    // Second click closes (toggle contract)
    fireEvent.click(volBtn);
    expect(container.querySelector('#desk-menu-vol')).toBeFalsy();
    // Desktop mouse hover still opens (via pointer/mouseEnter)
    fireEvent.mouseEnter(wrapper);
    expect(container.querySelector('#desk-menu-vol')).toBeTruthy();
    fireEvent.mouseLeave(wrapper);
    expect(container.querySelector('#desk-menu-vol')).toBeFalsy();
  });

  it('F2: ArrowDown at <=560px focuses the visible mobile menu item (mobile refs registered)', async () => {
    // Mock narrow viewport
    const origInnerWidth = window.innerWidth;
    const origMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 });
    (window as any).matchMedia = (q: string) => ({
      matches: q.includes('560') ? true : q.includes('coarse') ? true : false,
      media: q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    try {
      const { container } = render(<FunctionMenuBar />);
      const volBtn = container.querySelector('button[title="Vol (1)"]') as HTMLButtonElement;
      volBtn.focus();
      fireEvent.keyDown(volBtn, { key: 'ArrowDown' });
      await new Promise((r) => setTimeout(r, 25));
      // Mobile menu should be rendered and its first item focused (not the hidden desktop item)
      const mobileMenu = container.querySelector('#desk-menu-vol-mobile') as HTMLElement;
      expect(mobileMenu).toBeTruthy();
      const firstMobileItem = mobileMenu?.querySelector('[role="menuitem"]') as HTMLElement;
      expect(firstMobileItem).toBeTruthy();
      expect(document.activeElement).toBe(firstMobileItem);
      // Home/End within mobile menu
      const items = Array.from(mobileMenu.querySelectorAll('[role="menuitem"]')) as HTMLElement[];
      fireEvent.keyDown(items[0], { key: 'End' });
      expect(document.activeElement).toBe(items[items.length - 1]);
      fireEvent.keyDown(items[items.length - 1], { key: 'Home' });
      expect(document.activeElement).toBe(items[0]);
    } finally {
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: origInnerWidth });
      window.matchMedia = origMatchMedia;
    }
  });

  it('F2 pending intent: Enter/Space from closed mobile menu focuses visible item after mount (jsdom note)', async () => {
    // jsdom limitation: CSS media queries are not evaluated, pointerType is synthetic, and
    // fixed-position layout (mobileDropdownPos) is mocked via innerWidth/matchMedia only.
    // This test proves the pending-intent logic (focus after React commit/ref availability)
    // without claiming to prove real 390px CSS rendering — that requires Playwright at 390x844.
    const origInnerWidth = window.innerWidth;
    const origMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 });
    (window as any).matchMedia = (q: string) => ({
      matches: q.includes('560') ? true : false,
      media: q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    try {
      const { container } = render(<FunctionMenuBar />);
      const volBtn = container.querySelector('button[title="Vol (1)"]') as HTMLButtonElement;
      // Enter from fully closed
      volBtn.focus();
      fireEvent.keyDown(volBtn, { key: 'Enter' });
      await new Promise((r) => setTimeout(r, 25));
      let mobileMenu = container.querySelector('#desk-menu-vol-mobile') as HTMLElement;
      expect(mobileMenu).toBeTruthy();
      expect(document.activeElement).toBe(mobileMenu.querySelector('[role="menuitem"]'));
      // Dismiss then Space from closed
      fireEvent.keyDown(document, { key: 'Escape' });
      await new Promise((r) => setTimeout(r, 25));
      volBtn.focus();
      fireEvent.keyDown(volBtn, { key: ' ' });
      await new Promise((r) => setTimeout(r, 25));
      mobileMenu = container.querySelector('#desk-menu-vol-mobile') as HTMLElement;
      expect(mobileMenu).toBeTruthy();
      expect(document.activeElement).toBe(mobileMenu.querySelector('[role="menuitem"]'));
      // Pointer/touch open must NOT steal focus — no pending intent for click
      fireEvent.keyDown(document, { key: 'Escape' });
      await new Promise((r) => setTimeout(r, 15));
      volBtn.focus();
      const before = document.activeElement;
      fireEvent.click(volBtn);
      await new Promise((r) => setTimeout(r, 15));
      // Click open keeps focus on button (or at least not auto-moved to menuitem)
      expect(document.activeElement).toBe(before);
      // Desk change clears pending intent (no stale focus)
      fireEvent.keyDown(document, { key: 'Escape' });
      await new Promise((r) => setTimeout(r, 10));
    } finally {
      Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: origInnerWidth });
      window.matchMedia = origMatchMedia;
    }
  });

  it('F3: aria-controls absent when closed, Escape inside CommandLine does not swallow', async () => {
    const { container } = render(<FunctionMenuBar />);
    const volBtn = container.querySelector('button[title="Vol (1)"]') as HTMLButtonElement;
    expect(volBtn.getAttribute('aria-controls')).toBeNull();
    fireEvent.click(volBtn);
    expect(volBtn.getAttribute('aria-controls')).toContain('desk-menu-vol');
    // Open menu, then Escape inside CommandLine input should not close the menu (scoped handler)
    const cmdInput = container.querySelector('[aria-label="Command line"] input') as HTMLInputElement;
    expect(cmdInput).toBeTruthy();
    cmdInput.focus();
    fireEvent.keyDown(cmdInput, { key: 'Escape' });
    // Simulate bubbling Escape from inside CommandLine to document (scoped handler should ignore)
    const evt = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    Object.defineProperty(evt, 'target', { value: cmdInput });
    document.dispatchEvent(evt);
    await new Promise((r) => setTimeout(r, 10));
    // If scoping works, menu still open
    expect(container.querySelector('#desk-menu-vol') || container.querySelector('#desk-menu-vol-mobile')).toBeTruthy();
    // Escape on desk button should close
    volBtn.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    await new Promise((r) => setTimeout(r, 10));
    expect(container.querySelector('#desk-menu-vol')).toBeFalsy();
  });
});
