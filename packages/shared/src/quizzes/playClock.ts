export const MAX_PLAY_DURATION_MS = 3_600_000;

export interface PlayClock {
  start(now: number): void;
  answered(now: number): void;
  elapsed(now: number, complete: boolean): number;
  durationMs(now: number): number;
}

export function createPlayClock(): PlayClock {
  let startedAt: number | null = null;
  let lastAnswerAt: number | null = null;
  return {
    start(now) {
      startedAt ??= now;
    },
    answered(now) {
      lastAnswerAt = now;
    },
    elapsed(now, complete) {
      if (startedAt === null) return 0;
      return Math.max(0, (complete && lastAnswerAt !== null ? lastAnswerAt : now) - startedAt);
    },
    durationMs(now) {
      if (startedAt === null) return 0;
      return Math.min(MAX_PLAY_DURATION_MS, Math.max(0, (lastAnswerAt ?? now) - startedAt));
    }
  };
}
