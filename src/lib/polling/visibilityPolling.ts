/** Visibility-aware single-flight polling scheduler used by live widgets. */
export function startVisibilityPolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  immediate = true,
): () => void {
  let stopped = false;
  let inFlight = false;
  const run = () => {
    if (stopped || inFlight || (typeof document !== 'undefined' && document.hidden)) return;
    inFlight = true;
    let result: void | Promise<void>;
    try {
      result = callback();
    } catch {
      // Owners report their own errors; the scheduler must remain usable.
      inFlight = false;
      return;
    }
    Promise.resolve(result).then(
      () => { inFlight = false; },
      () => { inFlight = false; },
    );
  };
  if (immediate) run();
  const id = globalThis.setInterval(run, intervalMs);
  return () => { stopped = true; globalThis.clearInterval(id); };
}
