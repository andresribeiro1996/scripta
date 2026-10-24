import { startJob, type JobTimers } from "../../jobs.js";
import type { BooksRepository } from "./domain/ports.js";
import { failureKind, nextUtcMidnight, strikeReason } from "./typesafe.js";
import { createWorkQueue } from "./workQueue.js";

export const JEV_IN_FLIGHT = 4;
export const JEV_REJECTION_LIMIT = 3;
export const JEV_SWEEP_LIMIT = 1000;
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const HELD_CACHE_MS = 60 * 1000;
const OUTAGE_PAUSE_MS = 10 * 60 * 1000;
const KEY_PAUSE_MS = 24 * 60 * 60 * 1000;
const COST_PER_REQUEST_USD = 0.00012;

export type JevStop = "done" | "budget" | "outage" | "key";
export type JevPauseKind = Exclude<JevStop, "done">;
export type JevPauseDeps = { now: () => number; alert: (subject: string, text: string) => void; onPause?: (kind: JevPauseKind, until: number) => void };
export type JevKeyAlert = { subject: string; text: string };
export type JevStrike = { status: number | null; reason: string };

export const jevCostUsd = (requests: number): number => Number((requests * COST_PER_REQUEST_USD).toFixed(2));

export const heldCanonical = (repo: Pick<BooksRepository, "canonicalWorkIds">, heldWorkIds: string[]): Set<string> => new Set(repo.canonicalWorkIds(heldWorkIds).values());

export function jevPause(error: unknown, deps: JevPauseDeps, keyAlert: JevKeyAlert, strike: (strike: JevStrike) => void): number | null {
  const kind = failureKind(error);
  if (kind === null) throw error;
  if (kind === "book") {
    strike(strikeReason(error));
    return null;
  }
  if (kind === "key") deps.alert(keyAlert.subject, keyAlert.text);
  const until = kind === "budget" ? nextUtcMidnight(deps.now()) : deps.now() + (kind === "outage" ? OUTAGE_PAUSE_MS : KEY_PAUSE_MS);
  deps.onPause?.(kind, until);
  return until;
}

export async function runJevBacklog(
  items: string[],
  judgeOne: (item: string, onPause: (kind: JevPauseKind, until: number) => void) => Promise<number | null>
): Promise<{ asked: string[]; stoppedBy: JevStop }> {
  const asked: string[] = [];
  let stoppedBy: JevStop = "done";
  let next = 0;
  const worker = async () => {
    while (stoppedBy === "done" && next < items.length) {
      const item = items[next++]!;
      let kind: JevPauseKind | null = null;
      const pause = await judgeOne(item, (paused) => { kind = paused; });
      if (pause === null) asked.push(item);
      else if (stoppedBy === "done") stoppedBy = kind ?? "outage";
    }
  };
  await Promise.all(Array.from({ length: JEV_IN_FLIGHT }, worker));
  return { asked, stoppedBy };
}

export type JevJobs = { add(workId: string): void; stop(): void };
export type JevJobsDeps = {
  repo: Pick<BooksRepository, "canonicalWorkIds">;
  heldWorkIds: () => string[];
  now: () => number;
  alert: (subject: string, text: string) => void;
  info: (details: Record<string, unknown>, message: string) => void;
  onError: (error: unknown, workId?: string) => void;
  timers?: JobTimers;
  initialDelayMs?: number;
};
export type JevJob = {
  source: string;
  budgetMessage: string;
  sweep: (heldWorkIds: string[]) => string[];
  judge: (workId: string, held: () => Set<string>, pause: JevPauseDeps) => Promise<number | null>;
};

export function startJevJobs(deps: JevJobsDeps, job: JevJob): JevJobs {
  let alertQuietUntil = 0;
  let budgetLoggedUntil = 0;
  let heldSince = 0;
  let heldSet: Set<string> | null = null;
  const pause: JevPauseDeps = {
    now: deps.now,
    alert: (subject, text) => {
      if (deps.now() < alertQuietUntil) return;
      alertQuietUntil = deps.now() + KEY_PAUSE_MS;
      deps.alert(subject, text);
    },
    onPause: (kind, until) => {
      if (kind !== "budget" || deps.now() < budgetLoggedUntil) return;
      budgetLoggedUntil = until;
      deps.info({ source: job.source, until: new Date(until).toISOString() }, job.budgetMessage);
    }
  };
  const refreshHeld = () => {
    heldSet = heldCanonical(deps.repo, deps.heldWorkIds());
    heldSince = deps.now();
    return heldSet;
  };
  const held = () => (!heldSet || deps.now() - heldSince >= HELD_CACHE_MS ? refreshHeld() : heldSet);
  const queue = createWorkQueue({ concurrency: JEV_IN_FLIGHT, now: deps.now, run: (workId) => job.judge(workId, held, pause), onError: deps.onError });
  const stopSweep = startJob(
    async () => {
      for (const workId of job.sweep([...refreshHeld()])) queue.add(workId);
      return null;
    },
    (error) => deps.onError(error),
    SWEEP_INTERVAL_MS,
    deps.timers,
    deps.initialDelayMs
  );
  return {
    add: (workId) => queue.add(workId),
    stop: () => {
      stopSweep();
      queue.stop();
    }
  };
}
