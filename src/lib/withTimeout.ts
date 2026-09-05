/**
 * Race a promise against a timeout so no single hanging dependency can trap
 * a loading gate forever. The loser keeps running (no cancellation), but the
 * caller always settles: slow success still wins if it beats the clock.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, timeoutValue: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(timeoutValue), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
