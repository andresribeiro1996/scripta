export const BACKFILL_INTERVAL_MS = 10 * 60 * 1000;
export const DETAILS_BATCH_SIZE = 50;

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

export function startDetailsBackfill(
  runBatch: (signal: AbortSignal) => Promise<void>,
  onError: (error: unknown) => void,
  intervalMs: number = BACKFILL_INTERVAL_MS,
  timers?: Timers
): () => void {
  const controller = new AbortController();
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    runBatch(controller.signal)
      .catch(onError)
      .finally(() => { running = false; });
  };
  tick();
  const stopTimer = startBackfill(tick, intervalMs, timers);
  return () => {
    controller.abort();
    stopTimer();
  };
}
