import { SourcePausedError, SourceUnavailableError } from "../../domain/errors.js";

export interface IsbndbPause {
  reason: "quota" | "key";
  until: number;
}

export interface IsbndbGate {
  run<T>(call: () => Promise<T>): Promise<T>;
}

function nextUtcMidnight(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

function pauseFor(error: SourceUnavailableError, now: number): IsbndbPause | null {
  if (error.status === 401 || error.status === 403) return { reason: "key", until: nextUtcMidnight(now) };
  if (error.status !== 429) return null;
  if (error.retryAt !== undefined) return { reason: "quota", until: error.retryAt };
  if (error.quota === true || /daily quota/i.test(error.message)) return { reason: "quota", until: nextUtcMidnight(now) };
  return null;
}

export function createIsbndbGate(options: { now?: () => number; onPause: (pause: IsbndbPause) => void }): IsbndbGate {
  const now = options.now ?? Date.now;
  let until = 0;

  const paused = () => new SourcePausedError("isbndb", `paused until ${new Date(until).toISOString()}`, { retryAt: until });

  return {
    async run(call) {
      if (now() < until) throw paused();
      try {
        return await call();
      } catch (error) {
        if (!(error instanceof SourceUnavailableError) || error instanceof SourcePausedError) throw error;
        const pause = pauseFor(error, now());
        if (!pause) throw error;
        if (now() < until) throw paused();
        until = pause.until;
        options.onPause(pause);
        throw paused();
      }
    }
  };
}
