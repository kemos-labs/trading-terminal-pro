/**
 * Provenance model — every datum carries source, venue, instrument, timestamps, native unit, freshness.
 * Raw, normalized, and derived are distinct layers.
 */

export type ProvenanceKind = 'observed' | 'exchange-derived' | 'locally-derived' | 'fitted' | 'heuristic' | 'stale' | 'unavailable';
export type Freshness = 'live' | 'stale' | 'partial' | 'unavailable';

export interface SourceEnvelope<T> {
  data: T | null;
  provenance: ProvenanceKind;
  freshness: Freshness;
  venue: string;
  instrument: string;
  nativeCurrency: string;
  sourceTimestamp: number | null; // when venue produced it
  receiveTimestamp: number; // when server received it
  ageMs: number | null;
  coverage: number | null; // 0..1 fraction of expected instruments present
  error?: string | null;
}

export interface InstrumentMeta {
  instrumentName: string;
  baseCurrency: string;
  quoteCurrency: string;
  settlementCurrency: string;
  contractSize: number;
  kind: 'future' | 'option' | 'spot' | 'perp';
  expiryMs: number | null;
  strike: number | null;
  optionType: 'call' | 'put' | null;
  isInverse: boolean;
}

export interface QuoteSnapshot {
  instrument: string;
  bidPrice: number | null;
  askPrice: number | null;
  markPrice: number | null;
  lastPrice: number | null;
  bidIv: number | null;
  askIv: number | null;
  markIv: number | null;
  indexPrice: number | null;
  openInterest: number | null; // underlying units
  volume: number | null;
  timestamp: number;
  isStale: boolean;
}
