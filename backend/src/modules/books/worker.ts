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
  const queued = new Set<string>();
  const requeue = new Set<string>();
  const active = new Set<string>();
  const idleWaiters: Array<() => void> = [];
  let running = 0;
  let stopped = false;

  async function drain() {
    try {
      while ((queue.length > 0 || background.length > 0) && !stopped) {
        const bookId = (queue.length > 0 ? queue : background).shift()!;
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
    enqueue(bookId, priority = "normal") {
      if (stopped) return;
      const front = priority === "front";
      if (active.has(bookId)) {
        if (front) requeue.add(bookId);
        return;
      }
      if (queued.has(bookId)) {
        if (priority === "background") return;
        const inBackground = background.indexOf(bookId);
        if (inBackground >= 0) background.splice(inBackground, 1);
        else if (!front) return;
        else queue.splice(queue.indexOf(bookId), 1);
      } else {
        queued.add(bookId);
      }
      if (front) queue.unshift(bookId);
      else if (priority === "normal") queue.push(bookId);
      else background.push(bookId);
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
      queued.clear();
      requeue.clear();
    }
  };
}
