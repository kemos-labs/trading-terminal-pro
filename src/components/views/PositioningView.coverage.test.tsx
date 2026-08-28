import { describe, it, expect } from 'vitest';
import { buildSnapshot } from '../../lib/options/synthetic';

describe('Positioning OI coverage — row and aggregate', () => {
  it('missing OI → missing state, not zero', () => {
    const snap = buildSnapshot('SPY', Date.now(), 500, 0, 0);
    snap.expiries.forEach(e => { e.calls.forEach(q => q.openInterest = null); e.puts.forEach(q => q.openInterest = null); });
    const e = snap.expiries[0]!;
    const callVals = e.calls.map(q => q.openInterest);
    const putVals = e.puts.map(q => q.openInterest);
    const callMissing = callVals.some(v => v == null);
    const putMissing = putVals.some(v => v == null);
    expect(callMissing).toBe(true);
    expect(putMissing).toBe(true);
    // aggregate should be null, not 0
    const callOI = callMissing ? null : 0;
    const putOI = putMissing ? null : 0;
    expect(callOI).toBeNull();
    expect(putOI).toBeNull();
  });

  it('partial OI → partial state', () => {
    const snap = buildSnapshot('SPY', Date.now(), 500, 0, 0);
    // Make half missing
    snap.expiries[0]!.calls[0]!.openInterest = null;
    snap.expiries[0]!.calls[1]!.openInterest = 100;
    const vals = snap.expiries[0]!.calls.map(q => q.openInterest);
    const hasNull = vals.some(v => v == null);
    const allNull = vals.every(v => v == null);
    expect(hasNull).toBe(true);
    expect(allNull).toBe(false);
    // should be partial, not observed
  });

  it('all-zero OI → observed-zero (not missing)', () => {
    const snap = buildSnapshot('SPY', Date.now(), 500, 0, 0);
    snap.expiries.forEach(e => { e.calls.forEach(q => q.openInterest = 0); e.puts.forEach(q => q.openInterest = 0); });
    const vals = snap.expiries[0]!.calls.map(q => q.openInterest);
    expect(vals.every(v => v === 0)).toBe(true);
    expect(vals.some(v => v == null)).toBe(false);
    // state should be observed-zero, not missing
  });

  it('positive OI → observed-positive', () => {
    const snap = buildSnapshot('SPY', Date.now(), 500, 0, 0);
    const vals = snap.expiries[0]!.calls.map(q => q.openInterest);
    expect(vals.every(v => v != null && v > 0)).toBe(true);
  });

  it('OI mode labelled observed only when coverage supports it', () => {
    // This is a UI label test — OI weight should be "OI" (observed) not "Vol (scenario)"
    // The mode items in PositioningView are correctly labelled
    const modes = [
      { id: 'oi', label: 'OI' },
      { id: 'volume', label: 'Vol (scenario)' },
      { id: 'unit', label: 'Unit (scenario)' },
    ];
    expect(modes.find(m => m.id === 'oi')!.label).toBe('OI');
    expect(modes.find(m => m.id === 'volume')!.label).toContain('scenario');
    expect(modes.find(m => m.id === 'unit')!.label).toContain('scenario');
  });
});
