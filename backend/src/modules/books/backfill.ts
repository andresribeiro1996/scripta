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

export const GROUPING_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface WorksSteps {
  assignMissingWorks: (limit: number) => number;
  fillTitleKeys: (limit: number) => number;
}

async function drainBatches(step: (limit: number) => number, signal: AbortSignal): Promise<number> {
  let total = 0;
  for (;;) {
    await new Promise(setImmediate);
    if (signal.aborted) return total;
    const batch = step(WORKS_BATCH_SIZE);
    total += batch;
    if (batch < WORKS_BATCH_SIZE) return total;
  }
}

export function startWorksBackfill(
  steps: WorksSteps,
  log: WorksLog,
  intervalMs?: number,
  timers?: Timers
): () => void {
  return startDetailsBackfill(
    async (signal) => {
      const assigned = await drainBatches(steps.assignMissingWorks, signal);
      const titleKeyed = await drainBatches(steps.fillTitleKeys, signal);
      if (assigned + titleKeyed > 0) log.info({ assigned, titleKeyed }, "updated works for existing editions");
    },
    (error) => log.error({ err: error }, "works backfill failed"),
    intervalMs,
    timers
  );
}

export interface WorksGrouping {
  runNow(): Promise<number | null>;
  stop(): void;
}

export function startWorksGrouping(
  groupKeylessWorks: (limit: number) => number,
  log: WorksLog,
  intervalMs: number = GROUPING_INTERVAL_MS,
  timers?: Timers
): WorksGrouping {
  const controller = new AbortController();
  let running = false;
  async function runNow(): Promise<number | null> {
    if (running) return null;
    running = true;
    try {
      const grouped = await drainBatches(groupKeylessWorks, controller.signal);
      if (grouped > 0) log.info({ grouped }, "grouped keyless works by title");
      return grouped;
    } finally {
      running = false;
    }
  }
  const tick = () => {
    runNow().catch((error: unknown) => log.error({ err: error }, "works grouping failed"));
  };
  tick();
  const stopTimer = startBackfill(tick, intervalMs, timers);
  return {
    runNow,
    stop: () => {
      controller.abort();
      stopTimer();
    }
  };
}
