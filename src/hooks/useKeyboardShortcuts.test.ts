import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

function fireKey(init: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
}

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fires bare letter shortcuts', () => {
    const r = vi.fn();
    renderHook(() => useKeyboardShortcuts({ r }));
    fireKey({ key: 'r' });
    expect(r).toHaveBeenCalled();
  });

  it('does not fire bare k when meta is held (Cmd+K isolation)', () => {
    const k = vi.fn();
    const modk = vi.fn();
    renderHook(() => useKeyboardShortcuts({ k, 'mod+k': modk }));
    fireKey({ key: 'k', metaKey: true });
    expect(k).not.toHaveBeenCalled();
    expect(modk).toHaveBeenCalled();
  });

  it('does not fire tab1 when alt is held', () => {
    const tab1 = vi.fn();
    renderHook(() => useKeyboardShortcuts({ tab1 }));
    fireKey({ key: '1', altKey: true });
    expect(tab1).not.toHaveBeenCalled();
  });

  it('leaves bare Tab/Shift+Tab native (no desk-cycle handler)', () => {
    const tab = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts({ tab }));
    const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab' });
    const prevented: boolean[] = [];
    window.addEventListener('keydown', (e) => { prevented.push(e.defaultPrevented); }, { once: true });
    window.dispatchEvent(ev);
    expect(tab).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
    const evShift = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab', shiftKey: true });
    window.dispatchEvent(evShift);
    expect(tab).not.toHaveBeenCalled();
    expect(evShift.defaultPrevented).toBe(false);
    unmount();
  });

  it('does not hijack ArrowDown when no board holds focus', () => {
    const arrowdown = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts({ arrowdown }));
    const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' });
    window.dispatchEvent(ev);
    expect(arrowdown).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
    unmount();
  });

  it('does not toggle play on Space when a button holds focus', () => {
    const space = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts({ space }));
    document.body.innerHTML = '<button id="b">x</button>';
    const btn = document.getElementById('b')!;
    const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ' ' });
    btn.dispatchEvent(ev);
    expect(space).not.toHaveBeenCalled();
    unmount();
    document.body.innerHTML = '';
  });
});
