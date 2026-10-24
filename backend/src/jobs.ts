export const BACKFILL_INTERVAL_MS = 10 * 60 * 1000;

export interface JobTimers {
  setInterval: (callback: () => void, delay: number) => NodeJS.Timeout;
  clearInterval: (timer: NodeJS.Timeout) => void;
  setTimeout: (callback: () => void, delay: number) => NodeJS.Timeout;
  clearTimeout: (timer: NodeJS.Timeout) => void;
}

export const systemTimers = (): JobTimers => ({ setInterval, clearInterval, setTimeout, clearTimeout });

export function startTimer(
  callback: () => void,
  intervalMs: number,
  timers: JobTimers = systemTimers()
): () => void {
  const timer = timers.setInterval(callback, intervalMs).unref();
  return () => timers.clearInterval(timer);
}

export function startFirstRun(tick: () => void, initialDelayMs: number, timers: JobTimers): () => void {
  if (initialDelayMs <= 0) {
    tick();
    return () => {};
  }
  const timer = timers.setTimeout(tick, initialDelayMs).unref();
  return () => timers.clearTimeout(timer);
}

export function startJob(
  run: (signal: AbortSignal) => Promise<number | null | void>,
  onError: (error: unknown) => void,
  intervalMs: number = BACKFILL_INTERVAL_MS,
  timers: JobTimers = systemTimers(),
  initialDelayMs: number = 0,
  now: () => number = Date.now
): () => void {
  const controller = new AbortController();
  let running = false;
  let pausedUntil = 0;
  const tick = () => {
    if (running || now() < pausedUntil) return;
    running = true;
    run(controller.signal)
      .then((retryAt) => { pausedUntil = retryAt ?? 0; })
      .catch(onError)
      .finally(() => { running = false; });
  };
  const stopFirstRun = startFirstRun(tick, initialDelayMs, timers);
  const stopTimer = startTimer(tick, intervalMs, timers);
  return () => {
    controller.abort();
    stopFirstRun();
    stopTimer();
  };
}

export interface Jobs {
  every(
    name: string,
    intervalMs: number,
    run: (signal: AbortSignal) => Promise<number | null | void> | number | null | void,
    initialDelayMs?: number
  ): void;
  own(stop: () => void): void;
  stopAll(): void;
}

export function createJobs(log: { error(details: object, message: string): void }, timers?: JobTimers): Jobs {
  const stops: Array<() => void> = [];
  return {
    every(name, intervalMs, run, initialDelayMs) {
      stops.push(
        startJob(
          async (signal) => run(signal),
          (error) => log.error({ err: error }, `${name} failed`),
          intervalMs,
          timers,
          initialDelayMs
        )
      );
    },
    own(stop) {
      stops.push(stop);
    },
    stopAll() {
      for (const stop of stops.splice(0).reverse()) stop();
    }
  };
}
