/**
 * Vitest-compatible tests for KSA pure helpers (no network).
 * Run via the normal suite: npm test
 */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  normalizeKsaSymbol,
  riyadhSessionSnapshot,
  buildMegaFromMovers,
  isUsableBoard,
  findOnBoard,
  canAffordBoardPack,
  deriveBoardDepth,
  pushBoardHistory,
  getBoardHistory,
  KSA_BOARD_UPSTREAM_CALLS,
} from './ksaFeeds.js';

describe('normalizeKsaSymbol', () => {
  it('normalizes .SR', () => {
    assert.equal(normalizeKsaSymbol('2222.SR'), '2222');
  });
  it('rejects letters', () => {
    assert.equal(normalizeKsaSymbol('AAPL'), null);
  });
});

describe('riyadhSessionSnapshot', () => {
  it('Friday closed', () => {
    const s = riyadhSessionSnapshot(new Date('2026-07-17T10:00:00+03:00'));
    assert.equal(s.tradingDay, false);
    assert.equal(s.phase, 'closed');
  });
  it('Wed open', () => {
    const s = riyadhSessionSnapshot(new Date('2026-07-15T11:00:00+03:00'));
    assert.equal(s.phase, 'open');
    assert.equal(s.open, true);
  });
});

describe('buildMegaFromMovers', () => {
  it('prefers known mega caps then fills from volume', () => {
    const volume = [
      { symbol: '9999', price: 1, name_en: 'Other' },
      { symbol: '2222', price: 25, name_en: 'Aramco' },
      { symbol: '1120', price: 100, name_en: 'AlRajhi' },
    ];
    const mega = buildMegaFromMovers(volume, [], []);
    assert.equal(mega[0].symbol, '2222');
    assert.equal(mega[1].symbol, '1120');
    assert.ok(mega.some((m) => m.symbol === '9999'));
  });
});

describe('isUsableBoard', () => {
  it('requires finite TASI index_value', () => {
    assert.equal(isUsableBoard({ tasi: { index_value: 11000 } }), true);
    assert.equal(isUsableBoard({ tasi: { error: 'x' } }), false);
    assert.equal(isUsableBoard({ tasi: { index_value: null } }), false);
    assert.equal(isUsableBoard(null), false);
  });
});

describe('findOnBoard', () => {
  it('searches volume leaders', () => {
    const board = {
      mega: [],
      gainers: [],
      losers: [],
      volumeLeaders: [{ symbol: '4001', price: 12 }],
      valueLeaders: [],
    };
    assert.equal(findOnBoard(board, '4001')?.price, 12);
    assert.equal(findOnBoard(board, '9999'), null);
  });
});

describe('pack size constant', () => {
  it('documents free-tier call count', () => {
    assert.equal(KSA_BOARD_UPSTREAM_CALLS, 6);
  });
});

describe('canAffordBoardPack', () => {
  it('is true when unused (soft room for 6)', () => {
    assert.equal(canAffordBoardPack(), true);
  });
});

describe('deriveBoardDepth', () => {
  it('builds sector bars and breadth from pack fields', () => {
    const board = {
      tasi: { index_value: 11000, advancing: 80, declining: 40, unchanged: 10 },
      sectors: [
        { sector_name: 'Energy', change_percent: 1.2 },
        { sector_name: 'Banks', change_percent: -0.5 },
      ],
      gainers: [{ symbol: '2222', change_percent: 2 }],
      losers: [{ symbol: '1120', change_percent: -1 }],
      volumeLeaders: [{ symbol: '2222', volume: 1e6, change_percent: 2 }],
      fetched_at: '2026-07-16T10:00:00Z',
    };
    pushBoardHistory(board);
    const d = deriveBoardDepth(board);
    assert.ok(d);
    assert.equal(d.breadth.adv, 80);
    assert.ok(d.sectorBars.length >= 2);
    assert.ok(d.history.length >= 1);
    assert.equal(getBoardHistory().at(-1)?.tasi, 11000);
  });
});
