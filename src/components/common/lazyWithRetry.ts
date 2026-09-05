import { lazy, type ComponentType } from 'react';

/**
 * React.lazy with bounded retries for transient chunk-load failures
 * (deploy skew 404s, dev-server restarts mid-import, flaky networks).
 * Without retries, one failed chunk import parks the nearest Suspense
 * fallback on screen forever — on Vol that fallback reads "Building chain
 * surface…", indistinguishable from a data load and unrecoverable without
 * a full page refresh. Exhausted retries rethrow into the nearest error
 * boundary, which already offers a Retry section.
 */
export function lazyWithRetry<T extends ComponentType<Record<string, never>>>(
  importer: () => Promise<{ default: T }>,
  opts: { retries?: number; delayMs?: number } = {},
) {
  const { retries = 2, delayMs = 1000 } = opts;
  return lazy(async () => {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await importer();
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }
    throw lastError;
  });
}
