export const BACKFILL_INTERVAL_MS = 10 * 60 * 1000;
export const DETAILS_BATCH_SIZE = 50;
const WORKS_BATCH_SIZE = 250;

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
  runBatch: (signal: AbortSignal) => Promise<number | null | void>,
  onError: (error: unknown) => void,
  intervalMs: number = BACKFILL_INTERVAL_MS,
  timers?: Timers,
  now: () => number = Date.now
): () => void {
  const controller = new AbortController();
  let running = false;
  let pausedUntil = 0;
  const tick = () => {
    if (running || now() < pausedUntil) return;
    running = true;
    runBatch(controller.signal)
      .then((retryAt) => { pausedUntil = retryAt ?? 0; })
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

interface WorksLog {
  info: (details: object, message: string) => void;
  error: (details: object, message: string) => void;
}

export interface WorksSteps {
  assignMissingWorks: (limit: number) => number;
  fillTitleKeys: (limit: number) => number;
  groupKeylessWorks: (limit: number) => number;
}

export function startWorksBackfill(
  steps: WorksSteps,
  log: WorksLog,
  intervalMs?: number,
  timers?: Timers
): () => void {
  return startDetailsBackfill(
    async (signal) => {
      const counts = { assigned: 0, titleKeyed: 0, grouped: 0 };
      const drain = async (step: (limit: number) => number, field: keyof typeof counts) => {
        for (;;) {
          await new Promise(setImmediate);
          if (signal.aborted) return;
          const batch = step(WORKS_BATCH_SIZE);
          counts[field] += batch;
          if (batch < WORKS_BATCH_SIZE) return;
        }
      };
      await drain(steps.assignMissingWorks, "assigned");
      await drain(steps.fillTitleKeys, "titleKeyed");
      await drain(steps.groupKeylessWorks, "grouped");
      if (counts.assigned + counts.titleKeyed + counts.grouped > 0) log.info(counts, "updated works for existing editions");
    },
    (error) => log.error({ err: error }, "works backfill failed"),
    intervalMs,
    timers
  );
}
