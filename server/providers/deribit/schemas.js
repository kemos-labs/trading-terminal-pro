/**
 * Deribit response schemas — runtime validation for provider contract.
 */

export function isValidInstrument(raw) {
  return raw && typeof raw.instrument_name === 'string' && typeof raw.kind === 'string';
}

export function validateTicker(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid ticker shape');
  // must have instrument_name, mark_price, timestamp
  if (typeof raw.instrument_name !== 'string') throw new Error('ticker missing instrument_name');
  if (raw.mark_price != null && typeof raw.mark_price !== 'number') throw new Error('mark_price must be number');
  return true;
}

export function validateBookSummary(raw) {
  if (!Array.isArray(raw)) throw new Error('book summary must be array');
  for (const r of raw) {
    if (typeof r.instrument_name !== 'string') throw new Error('summary missing instrument_name');
  }
  return true;
}
