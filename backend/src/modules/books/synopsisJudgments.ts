import { createJevSynopsisClassifier, type ClassifySynopsis } from "./adapters/typesafe/jevSynopsis.js";
import { startDetailsBackfill } from "./backfill.js";
import type { BooksRepository } from "./domain/ports.js";
import { isFragment } from "./domain/synopsis.js";
import { dailySpend, failureKind, nextUtcMidnight, strikeReason } from "./typesafe.js";
import { createWorkQueue } from "./workQueue.js";

export const SYNOPSIS_SOURCE = "synopses";
export const SYNOPSIS_DAILY_BUDGET = 1000;
export const JEV_REJECTION_LIMIT = 3;
export const SYNOPSIS_IN_FLIGHT = 4;
const WORK_TEXT_LIMIT = 50;
const SWEEP_LIMIT = 1000;
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const HELD_CACHE_MS = 60 * 1000;
const OUTAGE_PAUSE_MS = 10 * 60 * 1000;
const KEY_PAUSE_MS = 24 * 60 * 60 * 1000;

export type SynopsisJudgmentDeps = {
  repo: BooksRepository;
  classify: ClassifySynopsis;
  now: () => number;
  alert: (subject: string, text: string) => void;
};
type HeldDeps = SynopsisJudgmentDeps & { heldWorkIds: () => string[] };
export type SynopsisJobs = { add(workId: string): void; stop(): void };

export function applySynopsisRule(repo: Pick<BooksRepository, "synopsisText" | "saveSynopsisJudgment">, hash: string, at: string): boolean {
  const carrier = repo.synopsisText(hash);
  if (!carrier || !isFragment(carrier.text)) return false;
  repo.saveSynopsisJudgment(hash, { model: "rule", usable: 0, kind: "fragment", askedAt: at });
  return true;
}

export async function classifyText(deps: SynopsisJudgmentDeps, hash: string): Promise<number | null> {
  const at = () => new Date(deps.now()).toISOString();
  if (applySynopsisRule(deps.repo, hash, at())) return null;
  const carrier = deps.repo.synopsisText(hash);
  if (!carrier) return null;
  try {
    const answer = await deps.classify(carrier);
    deps.repo.transaction(() => {
      deps.repo.saveSynopsisJudgment(hash, { model: answer.model, usable: answer.usable, kind: answer.kind, askedAt: at() });
      deps.repo.clearJevRejection("synopses", hash);
    });
    return null;
  } catch (error) {
    const kind = failureKind(error);
    if (kind === "book") {
      deps.repo.recordJevRejection({ task: "synopses", subject: hash, ...strikeReason(error), at: at() });
      return null;
    }
    if (kind === "budget") return nextUtcMidnight(deps.now());
    if (kind === "outage") return deps.now() + OUTAGE_PAUSE_MS;
    if (kind === "key") {
      deps.alert("TypeSafe rejected the synopsis requests", "TypeSafe answered 401, so synopsis checks are paused for a day. Check TYPESAFE_API_KEY.");
      return deps.now() + KEY_PAUSE_MS;
    }
    throw error;
  }
}

function heldCanonical(deps: HeldDeps): Set<string> {
  return new Set(deps.repo.canonicalWorkIds(deps.heldWorkIds()).values());
}

export async function judgeWorkSynopses(deps: HeldDeps, workId: string, held: () => Set<string> = () => heldCanonical(deps)): Promise<number | null> {
  const canonical = deps.repo.canonicalWorkIds([workId]).get(workId);
  if (!canonical || !held().has(canonical)) return null;
  for (const hash of deps.repo.synopsesNeedingJudgment([canonical], WORK_TEXT_LIMIT, JEV_REJECTION_LIMIT)) {
    const pause = await classifyText(deps, hash);
    if (pause !== null) return pause;
  }
  return null;
}

export function startSynopsisJobs(deps: HeldDeps & { info: (details: Record<string, unknown>, message: string) => void; onError: (error: unknown, workId?: string) => void }): SynopsisJobs {
  let quietUntil = 0;
  let budgetLoggedUntil = 0;
  let heldCache: { at: number; works: Set<string> } | null = null;
  const alert = (subject: string, text: string) => {
    if (deps.now() < quietUntil) return;
    quietUntil = deps.now() + KEY_PAUSE_MS;
    deps.alert(subject, text);
  };
  const held = () => {
    if (!heldCache || deps.now() - heldCache.at >= HELD_CACHE_MS) heldCache = { at: deps.now(), works: heldCanonical(deps) };
    return heldCache.works;
  };
  const classify: ClassifySynopsis = async (input) => {
    try {
      return await deps.classify(input);
    } catch (error) {
      if (failureKind(error) === "budget" && deps.now() >= budgetLoggedUntil) {
        budgetLoggedUntil = nextUtcMidnight(deps.now());
        deps.info({ source: SYNOPSIS_SOURCE, until: new Date(budgetLoggedUntil).toISOString() }, "TypeSafe budget spent; synopsis checks wait for the next UTC day");
      }
      throw error;
    }
  };
  const judged = { ...deps, alert, classify };
  const queue = createWorkQueue({ concurrency: SYNOPSIS_IN_FLIGHT, now: deps.now, run: (workId) => judgeWorkSynopses(judged, workId, held), onError: deps.onError });
  const stopSweep = startDetailsBackfill(
    async () => {
      heldCache = { at: deps.now(), works: heldCanonical(deps) };
      for (const workId of deps.repo.worksNeedingSynopsisJudgment([...heldCache.works], SWEEP_LIMIT, JEV_REJECTION_LIMIT)) queue.add(workId);
      return null;
    },
    (error) => deps.onError(error),
    SWEEP_INTERVAL_MS
  );
  return {
    add: (workId) => queue.add(workId),
    stop: () => {
      stopSweep();
      queue.stop();
    }
  };
}

export function startSynopsisJobsIfConfigured(apiKey: string, deps: Omit<Parameters<typeof startSynopsisJobs>[0], "classify">): SynopsisJobs | null {
  if (apiKey === "") return null;
  return startSynopsisJobs({ ...deps, classify: createJevSynopsisClassifier(apiKey, dailySpend(deps.repo, SYNOPSIS_SOURCE, SYNOPSIS_DAILY_BUDGET, deps.now)) });
}
