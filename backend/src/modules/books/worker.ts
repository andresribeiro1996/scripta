const SLOTS = 3;

export interface CoverWorker {
  enqueue(bookId: string, front?: boolean): void;
  idle(): Promise<void>;
  stop(): void;
}

export function createCoverWorker(
  processBook: (bookId: string) => Promise<void>,
  onError: (error: unknown, bookId: string) => void
): CoverWorker {
  const queue: string[] = [];
  const queued = new Set<string>();
  const requeue = new Set<string>();
  const active = new Set<string>();
  const idleWaiters: Array<() => void> = [];
  let running = 0;
  let stopped = false;

  async function drain() {
    try {
      while (queue.length > 0 && !stopped) {
        const bookId = queue.shift()!;
        queued.delete(bookId);
        active.add(bookId);
        try {
          await processBook(bookId);
        } catch (error) {
          onError(error, bookId);
        } finally {
          active.delete(bookId);
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
    enqueue(bookId, front = false) {
      if (stopped) return;
      if (active.has(bookId)) {
        if (front) requeue.add(bookId);
        return;
      }
      if (queued.has(bookId)) {
        if (!front) return;
        queue.splice(queue.indexOf(bookId), 1);
      } else {
        queued.add(bookId);
      }
      if (front) queue.unshift(bookId);
      else queue.push(bookId);
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
      queued.clear();
      requeue.clear();
    }
  };
}
