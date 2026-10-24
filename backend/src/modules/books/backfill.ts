export const BACKFILL_INTERVAL_MS = 10 * 60 * 1000;
export const DETAILS_BATCH_SIZE = 50;
const WORKS_BATCH_SIZE = 250;
const COLOR_BATCH_SIZE = 50;

interface Timers {
  setInterval: (callback: () => void, delay: number) => NodeJS.Timeout;
  clearInterval: (timer: NodeJS.Timeout) => void;
  setTimeout: (callback: () => void, delay: number) => NodeJS.Timeout;
  clearTimeout: (timer: NodeJS.Timeout) => void;
}

const systemTimers = (): Timers => ({ setInterval, clearInterval, setTimeout, clearTimeout });

export function startBackfill(
  enqueueUnchecked: () => void,
  intervalMs: number = BACKFILL_INTERVAL_MS,
  timers: Timers = systemTimers()
): () => void {
  const timer = timers.setInterval(enqueueUnchecked, intervalMs).unref();
  return () => timers.clearInterval(timer);
}

function startFirstRun(tick: () => void, initialDelayMs: number, timers: Timers): () => void {
  if (initialDelayMs <= 0) {
    tick();
    return () => {};
  }
  const timer = timers.setTimeout(tick, initialDelayMs).unref();
  return () => timers.clearTimeout(timer);
}

export function startDetailsBackfill(
  runBatch: (signal: AbortSignal) => Promise<number | null | void>,
  onError: (error: unknown) => void,
  intervalMs: number = BACKFILL_INTERVAL_MS,
  timers: Timers = systemTimers(),
  initialDelayMs: number = 0,
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
  const stopFirstRun = startFirstRun(tick, initialDelayMs, timers);
  const stopTimer = startBackfill(tick, intervalMs, timers);
  return () => {
    controller.abort();
    stopFirstRun();
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

async function drainBatches(step: (limit: number) => number | Promise<number>, signal: AbortSignal, size: number = WORKS_BATCH_SIZE): Promise<number> {
  let total = 0;
  for (;;) {
    await new Promise(setImmediate);
    if (signal.aborted) return total;
    const batch = await step(size);
    total += batch;
    if (batch < size) return total;
  }
}

export function startWorksBackfill(
  steps: WorksSteps,
  log: WorksLog,
  intervalMs?: number,
  timers?: Timers,
  initialDelayMs?: number
): () => void {
  return startDetailsBackfill(
    async (signal) => {
      const assigned = await drainBatches(steps.assignMissingWorks, signal);
      const titleKeyed = await drainBatches(steps.fillTitleKeys, signal);
      if (assigned + titleKeyed > 0) log.info({ assigned, titleKeyed }, "updated works for existing editions");
    },
    (error) => log.error({ err: error }, "works backfill failed"),
    intervalMs,
    timers,
    initialDelayMs
  );
}

export function startCoverColorBackfill(
  step: (limit: number) => Promise<number>,
  log: WorksLog,
  intervalMs?: number,
  timers?: Timers,
  initialDelayMs?: number
): () => void {
  return startDetailsBackfill(
    async (signal) => {
      const coloured = await drainBatches(step, signal, COLOR_BATCH_SIZE);
      if (coloured > 0) log.info({ coloured }, "coloured cover images");
    },
    (error) => log.error({ err: error }, "cover colour backfill failed"),
    intervalMs,
    timers,
    initialDelayMs
  );
}

export interface WorksGrouping {
  runNow(): Promise<number | null>;
  stop(): void;
}

export function startWorksGrouping(
  mergeDuplicates: (signal: AbortSignal) => Promise<number>,
  groupKeylessWorks: (limit: number) => number,
  log: WorksLog,
  intervalMs: number = GROUPING_INTERVAL_MS,
  timers: Timers = systemTimers(),
  initialDelayMs: number = 0
): WorksGrouping {
  const controller = new AbortController();
  let running = false;
  async function runNow(): Promise<number | null> {
    if (running) return null;
    running = true;
    try {
      await new Promise(setImmediate);
      const merged = await mergeDuplicates(controller.signal);
      if (merged > 0) log.info({ merged }, "merged duplicate Open Library works");
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
  const stopFirstRun = startFirstRun(tick, initialDelayMs, timers);
  const stopTimer = startBackfill(tick, intervalMs, timers);
  return {
    runNow,
    stop: () => {
      controller.abort();
      stopFirstRun();
      stopTimer();
    }
  };
}
