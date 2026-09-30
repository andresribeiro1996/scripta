const SLOTS = 3;

export type CoverPriority = "front" | "normal" | "background";

export interface CoverWorker {
  enqueue(bookId: string, priority?: CoverPriority): void;
  idle(): Promise<void>;
  stop(): void;
}

export function createCoverWorker(
  processBook: (bookId: string) => Promise<void>,
  onError: (error: unknown, bookId: string) => void
): CoverWorker {
  const queue: string[] = [];
  const background: string[] = [];
  const inBackground = new Set<string>();
  const queued = new Set<string>();
  const requeue = new Set<string>();
  const active = new Set<string>();
  const idleWaiters: Array<() => void> = [];
  let running = 0;
  let backgroundRunning = 0;
  let stopped = false;

  function next() {
    if (queue.length > 0) return { bookId: queue.shift()!, isBackground: false };
    if (backgroundRunning > 0) return undefined;
    while (background.length > 0) {
      const bookId = background.shift()!;
      if (inBackground.delete(bookId)) return { bookId, isBackground: true };
    }
    return undefined;
  }

  async function drain() {
    try {
      for (let item = next(); item && !stopped; item = next()) {
        const { bookId, isBackground } = item;
        queued.delete(bookId);
        active.add(bookId);
        if (isBackground) backgroundRunning++;
        try {
          await processBook(bookId);
        } catch (error) {
          onError(error, bookId);
        } finally {
          active.delete(bookId);
          if (isBackground) backgroundRunning--;
        }
        if (requeue.delete(bookId) && !queued.has(bookId)) {
          queued.add(bookId);
          queue.unshift(bookId);
        }
      }
    } finally {
      running--;
      if (running === 0) idleWaiters.splice(0).forEach((resolve) => resolve());
    }
  }

  return {
    enqueue(bookId, priority = "normal") {
      if (stopped) return;
      const front = priority === "front";
      if (active.has(bookId)) {
        if (front) requeue.add(bookId);
        return;
      }
      if (queued.has(bookId)) {
        if (priority === "background") return;
        if (!inBackground.delete(bookId)) {
          if (!front) return;
          queue.splice(queue.indexOf(bookId), 1);
        }
      } else {
        queued.add(bookId);
      }
      if (front) queue.unshift(bookId);
      else if (priority === "normal") queue.push(bookId);
      else {
        background.push(bookId);
        inBackground.add(bookId);
      }
      if (running < SLOTS) {
        running++;
        void drain();
      }
    },

    idle() {
      return running === 0 ? Promise.resolve() : new Promise<void>((resolve) => idleWaiters.push(resolve));
    },

    stop() {
      stopped = true;
      queue.length = 0;
      background.length = 0;
      inBackground.clear();
      queued.clear();
      requeue.clear();
    }
  };
}
