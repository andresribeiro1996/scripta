import { SourcePausedError, SourceUnavailableError } from "../../domain/errors.js";

export interface IsbndbPause {
  reason: "quota" | "key";
  until: number;
}

export interface IsbndbGate {
  run<T>(call: () => Promise<T>): Promise<T>;
}

export function nextUtcMidnight(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

const MIN_QUOTA_RESET_MS = 60_000;

function pauseFor(error: SourceUnavailableError, now: number): IsbndbPause | null {
  if (error.status === 401 || error.status === 403) return { reason: "key", until: nextUtcMidnight(now) };
  if (error.status !== 429) return null;
  const quota = error.quota === true || /daily quota/i.test(error.message);
  if (error.retryAt !== undefined && (quota || error.retryAt - now >= MIN_QUOTA_RESET_MS)) return { reason: "quota", until: error.retryAt };
  return quota ? { reason: "quota", until: nextUtcMidnight(now) } : null;
}

export function createIsbndbGate(options: { now?: () => number; onPause: (pause: IsbndbPause) => void }): IsbndbGate {
  const now = options.now ?? Date.now;
  let until = 0;
  let reason: IsbndbPause["reason"] = "quota";

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
        if (now() < until) {
          if (pause.reason !== "key" || reason === "key") throw paused();
          until = Math.max(until, pause.until);
          reason = "key";
          options.onPause({ reason, until });
          throw paused();
        }
        until = pause.until;
        reason = pause.reason;
        options.onPause(pause);
        throw paused();
      }
    }
  };
}
