export const BACKFILL_INTERVAL_MS = 10 * 60 * 1000;

interface Timers {
  setInterval: (callback: () => void, delay: number) => NodeJS.Timeout;
  clearInterval: (timer: NodeJS.Timeout) => void;
}

export function startBackfill(
  enqueueUnchecked: () => void,
  intervalMs: number = BACKFILL_INTERVAL_MS,
  timers: Timers = { setInterval, clearInterval }
): () => void {
  const timer = timers.setInterval(enqueueUnchecked, intervalMs).unref();
  return () => timers.clearInterval(timer);
}
