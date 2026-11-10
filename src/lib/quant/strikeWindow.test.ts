import { describe, it, expect } from 'vitest';
import { selectStrikeWindow, spotStatus, spotFraction } from './strikeWindow';

// Old buggy behavior for comparison: filter then slice(0,40)
function oldSelect(strikes: number[], spot: number, max = 40, pct = 0.18) {
  return [...strikes].sort((a, b) => a - b).filter((k) => Math.abs(k - spot) / spot < pct).slice(0, max);
}

describe('selectStrikeWindow', () => {
  it('dense chain around 770: old omits ATM, new includes ATM', () => {
    // 100 strikes from 600 to 900 step ~3, spot 770
    const strikes = Array.from({ length: 100 }, (_, i) => 600 + i * 3);
    const spot = 770.19;
    const old = oldSelect(strikes, spot);
    const nw = selectStrikeWindow(strikes, spot, 40);
    // Old takes first 40 of filtered (>= ~631) => max ~748, misses ATM 771
    expect(Math.max(...old)).toBeLessThan(770);
    expect(old.includes(771)).toBe(false);
    // New includes nearest to spot (771 or 768)
    expect(nw.includes(771) || nw.includes(768)).toBe(true);
    // Balanced: should span both sides of spot
    expect(Math.min(...nw)).toBeLessThan(spot);
    expect(Math.max(...nw)).toBeGreaterThan(spot);
    expect(nw.length).toBe(40);
    // Sorted ascending
    expect(nw).toEqual([...nw].sort((a, b) => a - b));
  });

  it('uneven strikes: sparse OTM put side still keeps ATM', () => {
    // Dense above spot, sparse below
    const below = [500, 550, 600, 650, 700, 740, 760];
    const above = Array.from({ length: 30 }, (_, i) => 771 + i * 2);
    const strikes = [...below, ...above];
    const spot = 770;
    const nw = selectStrikeWindow(strikes, spot, 20);
    expect(nw.includes(760) || nw.includes(771)).toBe(true);
    // Should have strikes on both sides
    expect(nw.some((k) => k < spot)).toBe(true);
    expect(nw.some((k) => k > spot)).toBe(true);
  });

  it('edge range: spot near low edge marks offscreen correctly', () => {
    const strikes = [600, 610, 620, 630, 640];
    const spot = 900;
    const win = selectStrikeWindow(strikes, spot, 40);
    // filtered empty -> fallback to all strikes
    expect(win).toEqual([600, 610, 620, 630, 640]);
    const status = spotStatus(spot, win);
    expect(status.offscreen).toBe(true);
    expect(status.nearest).toBe(640);
  });

  it('null spot returns sorted first N and offscreen', () => {
    const strikes = [800, 700, 750, 720];
    const win = selectStrikeWindow(strikes, null, 2);
    expect(win).toEqual([700, 720]);
    const status = spotStatus(null, win);
    expect(status.offscreen).toBe(true);
    expect(status.nearest).toBeNull();
  });

  it('spot inside window is not offscreen', () => {
    const strikes = [700, 740, 760, 770, 780, 800];
    const spot = 770.19;
    const win = selectStrikeWindow(strikes, spot, 40);
    const status = spotStatus(spot, win);
    expect(status.offscreen).toBe(false);
    expect(status.nearest).toBe(770);
  });

  it('preserves ordering and does not fabricate strikes', () => {
    const strikes = [710, 720, 730];
    const win = selectStrikeWindow(strikes, 720, 10);
    expect(win).toEqual([710, 720, 730]);
  });

  it('spot midway between uneven strikes interpolates fraction', () => {
    const strikes = [700, 710, 750, 800]; // uneven gaps 10,40,50
    // 725 is halfway between 710 and 750 (t=0.375)
    expect(spotFraction(725, strikes)).toBeCloseTo(1 + (15 / 40), 6);
    // 775 halfway between 750 and 800
    expect(spotFraction(775, strikes)).toBeCloseTo(2.5, 6);
    // exact match
    expect(spotFraction(750, strikes)).toBe(2);
  });

  it('spot beyond range returns null fraction', () => {
    const strikes = [700, 710, 720];
    expect(spotFraction(800, strikes)).toBeNull();
    expect(spotFraction(600, strikes)).toBeNull();
    expect(spotFraction(null, strikes)).toBeNull();
  });
});
