/**
 * Riyadh equity session helpers (mirror of server api/ksaFeeds.js logic).
 * Used for pure unit tests and offline UI chrome.
 */

export type RiyadhPhase = 'closed' | 'preopen' | 'open' | 'postclose';

export function riyadhSessionSnapshot(now: Date = new Date()): {
  timezone: string;
  local: string;
  weekday: string;
  tradingDay: boolean;
  phase: RiyadhPhase;
  open: boolean;
  sessionNote: string;
} {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  );
  const weekday = parts.weekday ?? '';
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const mins = hour * 60 + minute;
  const openMins = 10 * 60;
  const closeMins = 15 * 60 + 20;
  const tradingDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].includes(weekday);
  const continuous = tradingDay && mins >= openMins && mins < closeMins;
  const preopen = tradingDay && mins >= 9 * 60 + 30 && mins < openMins;
  let phase: RiyadhPhase = 'closed';
  if (preopen) phase = 'preopen';
  else if (continuous) phase = 'open';
  else if (tradingDay && mins >= closeMins && mins < 16 * 60) phase = 'postclose';

  return {
    timezone: 'Asia/Riyadh',
    local: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`,
    weekday,
    tradingDay,
    phase,
    open: continuous,
    sessionNote: 'Equity continuous ~10:00–15:20 Riyadh · week Sun–Thu · T+2 · SAR',
  };
}

export function normalizeKsaSymbol(raw: string): string | null {
  let s = raw.trim().toUpperCase();
  if (s.endsWith('.SR') || s.endsWith('.SA')) s = s.slice(0, -3);
  s = s.replace(/[^0-9]/g, '');
  if (!s || s.length > 6) return null;
  return s;
}
