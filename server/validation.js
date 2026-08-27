/** Shared server-side input validation. */
export function validateSymbol(symbol) {
  if (!symbol || typeof symbol !== 'string') return null;
  const sanitized = symbol.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,11}$/.test(sanitized)) return null;
  return sanitized;
}
