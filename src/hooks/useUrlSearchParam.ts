import { useCallback, useEffect, useState } from 'react';

/**
 * Deep-linkable filter state backed by one URL search param.
 *
 * - Initial value comes from the URL when it is in `allowed`, else `fallback`.
 * - Writes go through `history.replaceState` (no navigation, no re-fetch).
 * - `fallback` removes the param so default views keep clean URLs.
 * - `popstate` keeps the value honest when the user hits back/forward.
 */
export function useUrlSearchParam(
  key: string,
  allowed: readonly string[],
  fallback: string,
): [string, (next: string) => void] {
  const readInitial = useCallback((): string => {
    if (typeof window === 'undefined') return fallback;
    const v = new URL(window.location.href).searchParams.get(key);
    return v != null && allowed.includes(v) ? v : fallback;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fallback, allowed.join('|')]);

  const [value, setValue] = useState(readInitial);

  const set = useCallback(
    (next: string) => {
      setValue(next);
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      if (next === fallback) url.searchParams.delete(key);
      else url.searchParams.set(key, next);
      window.history.replaceState(null, '', url.toString());
    },
    [key, fallback],
  );

  useEffect(() => {
    const onPop = () => setValue(readInitial());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [readInitial]);

  return [value, set];
}
