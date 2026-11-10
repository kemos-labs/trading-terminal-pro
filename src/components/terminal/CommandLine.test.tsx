import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CommandLine } from './CommandLine';

function setup() {
  return render(<CommandLine />);
}

function combo(): HTMLInputElement {
  return screen.getByRole('combobox') as HTMLInputElement;
}

describe('CommandLine keyboard accessibility', () => {
  it('focus alone does not open a tab-stop trap; input is the single tabstop', () => {
    setup();
    fireEvent.focus(combo());
    expect(screen.queryByRole('listbox')).toBeNull();
    // No option tab stops present
    expect(screen.queryAllByRole('option').length).toBe(0);
    expect(combo().getAttribute('aria-expanded')).toBe('false');
  });

  it('typing opens list with non-tabstop options and coherent aria-activedescendant', () => {
    setup();
    fireEvent.focus(combo());
    fireEvent.change(combo(), { target: { value: 'vol' } });
    const list = screen.getByRole('listbox');
    expect(list).toBeTruthy();
    const opts = screen.getAllByRole('option');
    expect(opts.length).toBeGreaterThan(0);
    for (const o of opts) expect(o.getAttribute('tabindex')).toBe('-1');
    const activeId = combo().getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    const active = document.getElementById(activeId!);
    expect(active).toBeTruthy();
    expect(active!.getAttribute('role')).toBe('option');
    expect(active!.getAttribute('aria-selected')).toBe('true');
  });

  it('arrows + Enter selects the expected command and Tab leaves without walking options', () => {
    setup();
    fireEvent.change(combo(), { target: { value: 'vol' } });
    const before = screen.getAllByRole('option').length;
    expect(before).toBeGreaterThan(1);
    const firstId = combo().getAttribute('aria-activedescendant');
    fireEvent.keyDown(combo(), { key: 'ArrowDown' });
    const secondId = combo().getAttribute('aria-activedescendant');
    expect(secondId).not.toBe(firstId);
    // Tab dismisses list and keeps focus movement natural (no preventDefault here)
    // but must stop propagation so the global `tab` desk-cycle shortcut never fires
    // while focus is in the command line.
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    const stopped = vi.fn();
    tabEvent.stopPropagation = stopped;
    fireEvent(combo(), tabEvent);
    expect(stopped).toHaveBeenCalled();
    expect(tabEvent.defaultPrevented).toBe(false);
    expect(screen.queryByRole('listbox')).toBeNull();
    // Reopen, arrow to second row, Enter selects → list closes, query cleared
    fireEvent.change(combo(), { target: { value: 'vol' } });
    fireEvent.keyDown(combo(), { key: 'ArrowDown' });
    const targetId = combo().getAttribute('aria-activedescendant');
    const targetLabel = document.getElementById(targetId!)?.textContent ?? '';
    fireEvent.keyDown(combo(), { key: 'Enter' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(combo().value).toBe('');
    expect(targetLabel.length).toBeGreaterThan(0);
  });

  it('Escape closes the list without navigation side effects', () => {
    setup();
    fireEvent.change(combo(), { target: { value: 'vol' } });
    expect(screen.getByRole('listbox')).toBeTruthy();
    const stop = vi.fn();
    // Listener on document to prove stopPropagation on Escape
    const onDoc = (e: Event) => {
      if ((e as KeyboardEvent).key === 'Escape') stop();
    };
    document.addEventListener('keydown', onDoc);
    fireEvent.keyDown(combo(), { key: 'Escape' });
    document.removeEventListener('keydown', onDoc);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(stop).not.toHaveBeenCalled();
    expect(combo().value).toBe('vol'); // query preserved, desk untouched
  });

  it('mouse option click still runs the command', () => {
    setup();
    fireEvent.change(combo(), { target: { value: 'vol' } });
    const opts = screen.getAllByRole('option');
    fireEvent.click(opts[0]);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(combo().value).toBe('');
  });
});
