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
  let current: string | null = null;
  let draining: Promise<void> | null = null;
  let stopped = false;

  async function drain() {
    while (queue.length > 0 && !stopped) {
      const bookId = queue.shift()!;
      queued.delete(bookId);
      current = bookId;
      try {
        await processBook(bookId);
      } catch (error) {
        onError(error, bookId);
      } finally {
        current = null;
      }
      if (requeue.delete(bookId) && !queued.has(bookId)) {
        queued.add(bookId);
        queue.unshift(bookId);
      }
    }
    draining = null;
  }

  return {
    enqueue(bookId, front = false) {
      if (stopped) return;
      if (bookId === current) {
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
      draining ??= drain();
    },

    idle() {
      return draining ?? Promise.resolve();
    },

    stop() {
      stopped = true;
      queue.length = 0;
      queued.clear();
      requeue.clear();
    }
  };
}
