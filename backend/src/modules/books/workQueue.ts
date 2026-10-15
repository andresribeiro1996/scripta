export type WorkQueue = { add(workId: string): void; size(): number; stop(): void };

export type WorkQueueOptions = {
  concurrency: number;
  run: (workId: string) => Promise<number | null>;
  onError: (error: unknown, workId: string) => void;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => () => void;
  schedule?: (callback: () => void) => void;
};

function unrefTimer(callback: () => void, ms: number): () => void {
  const timer = setTimeout(callback, ms);
  timer.unref();
  return () => clearTimeout(timer);
}

export function createWorkQueue(options: WorkQueueOptions): WorkQueue {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? unrefTimer;
  const schedule = options.schedule ?? ((callback: () => void) => { setImmediate(callback); });
  const waiting: string[] = [];
  const known = new Set<string>();
  let running = 0;
  let pausedUntil = 0;
  let cancelResume: (() => void) | null = null;
  let stopped = false;

  function armResume() {
    cancelResume = setTimer(() => {
      cancelResume = null;
      if (now() < pausedUntil) armResume();
      else pump();
    }, Math.max(0, pausedUntil - now()));
  }

  function pauseUntil(at: number) {
    if (at <= pausedUntil) return;
    pausedUntil = at;
    cancelResume?.();
    armResume();
  }

  function pump() {
    while (!stopped && now() >= pausedUntil && running < options.concurrency && waiting.length > 0) {
      const workId = waiting.shift()!;
      running += 1;
      Promise.resolve()
        .then(() => options.run(workId))
        .then((resumeAt) => {
          if (resumeAt === null || stopped) {
            known.delete(workId);
            return;
          }
          waiting.unshift(workId);
          pauseUntil(resumeAt);
        })
        .catch((error: unknown) => {
          known.delete(workId);
          options.onError(error, workId);
        })
        .finally(() => {
          running -= 1;
          pump();
        });
    }
  }

  return {
    add(workId) {
      if (stopped || known.has(workId)) return;
      known.add(workId);
      waiting.push(workId);
      schedule(pump);
    },
    size: () => known.size,
    stop() {
      stopped = true;
      cancelResume?.();
      cancelResume = null;
      waiting.length = 0;
      known.clear();
    }
  };
}
