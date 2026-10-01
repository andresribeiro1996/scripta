const SLOTS = 3;

export type CoverPriority = "front" | "normal" | "upgrade" | "background";

export interface CoverWorker {
  enqueue(bookId: string, priority?: CoverPriority): void;
  idle(): Promise<void>;
  stop(): void;
}

export function createCoverWorker(
  processBook: (bookId: string, lane: CoverPriority) => Promise<void>,
  onError: (error: unknown, bookId: string) => void
): CoverWorker {
  const queue: string[] = [];
  const upgrade: string[] = [];
  const background: string[] = [];
  const queued = new Map<string, CoverPriority>();
  const requeue = new Set<string>();
  const active = new Set<string>();
  const idleWaiters: Array<() => void> = [];
  let running = 0;
  let appleRunning = 0;
  let stopped = false;

  function takeFrom(list: string[], lane: CoverPriority) {
    while (list.length > 0) {
      const bookId = list.shift()!;
      if (queued.get(bookId) === lane) return { bookId, lane };
    }
    return undefined;
  }

  function next() {
    if (queue.length > 0) {
      const bookId = queue.shift()!;
      return { bookId, lane: queued.get(bookId)! };
    }
    if (appleRunning > 0) return undefined;
    return takeFrom(upgrade, "upgrade") ?? takeFrom(background, "background");
  }

  async function drain() {
    try {
      for (let item = next(); item && !stopped; item = next()) {
        const { bookId, lane } = item;
        const apple = lane === "upgrade" || lane === "background";
        queued.delete(bookId);
        active.add(bookId);
        if (apple) appleRunning++;
        try {
          await processBook(bookId, lane);
        } catch (error) {
          onError(error, bookId);
        } finally {
          active.delete(bookId);
          if (apple) appleRunning--;
        }
        if (requeue.delete(bookId) && !queued.has(bookId)) {
          queued.set(bookId, "front");
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
      const fast = front || priority === "normal";
      if (active.has(bookId)) {
        if (front) requeue.add(bookId);
        return;
      }
      const current = queued.get(bookId);
      if (current) {
        if (!fast || current === "upgrade") return;
        if (current !== "background") {
          if (!front) return;
          queue.splice(queue.indexOf(bookId), 1);
        }
      }
      queued.set(bookId, priority);
      if (front) queue.unshift(bookId);
      else if (priority === "normal") queue.push(bookId);
      else if (priority === "upgrade") upgrade.push(bookId);
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
      upgrade.length = 0;
      background.length = 0;
      queued.clear();
      requeue.clear();
    }
  };
}
