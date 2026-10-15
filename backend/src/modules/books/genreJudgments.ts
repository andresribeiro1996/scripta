import { createJevGenreClassifier, type ClassifyGenre, type JevBook } from "./adapters/typesafe/jevGenres.js";
import { startDetailsBackfill } from "./backfill.js";
import { SourceUnavailableError, UnusableAnswerError } from "./domain/errors.js";
import type { BooksRepository } from "./domain/ports.js";
import type { GenreEvidence } from "./domain/types.js";
import { GENRE_SAVE_LINE, longestSynopsis } from "./genrePass.js";
import { dailySpend, failureKind, nextUtcMidnight, TypesafeBudgetSpentError } from "./typesafe.js";
import { createWorkQueue } from "./workQueue.js";

export { GENRE_SAVE_LINE };
export const GENRE_SOURCE = "genres";
export const GENRE_DAILY_BUDGET = 1000;
export const GENRE_REJECTION_LIMIT = 3;
export const GENRE_IN_FLIGHT = 4;
const GENRE_SWEEP_LIMIT = 1000;
const GENRE_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const HELD_CACHE_MS = 60 * 1000;
const OUTAGE_PAUSE_MS = 10 * 60 * 1000;
const KEY_PAUSE_MS = 24 * 60 * 60 * 1000;

export type GenreJudgmentDeps = {
  repo: BooksRepository;
  classify: ClassifyGenre;
  now: () => number;
  alert: (subject: string, text: string) => void;
};
type HeldDeps = GenreJudgmentDeps & { heldWorkIds: () => string[] };
export type GenreJobs = { add(workId: string): void; stop(): void };

const distinct = (values: Array<string | null>) => [...new Set(values.filter((value): value is string => Boolean(value)))];

export function jevBookOf(evidence: GenreEvidence): JevBook {
  return {
    title: evidence.work.title,
    author: evidence.work.author,
    editionLanguages: distinct(evidence.editions.map((edition) => edition.language)),
    publishers: distinct(evidence.editions.map((edition) => edition.publisher)),
    synopsis: longestSynopsis(evidence)
  };
}

function strikeReason(error: unknown): { status: number | null; reason: string } {
  if (error instanceof UnusableAnswerError) return { status: null, reason: error.detail };
  const status = (error as SourceUnavailableError).status ?? null;
  return { status, reason: `HTTP ${status}` };
}

export async function classifyWork(deps: GenreJudgmentDeps, workId: string): Promise<number | null> {
  const evidence = deps.repo.genreEvidence(workId);
  if (!evidence) return null;
  const at = () => new Date(deps.now()).toISOString();
  try {
    const judgment = await deps.classify(jevBookOf(evidence));
    deps.repo.transaction(() => {
      deps.repo.saveGenreJudgment({ workId, model: judgment.model, genre: judgment.genre, confidence: judgment.confidence, askedAt: at() });
      deps.repo.clearGenreRejection(workId);
      deps.repo.applyGenreJudgment(workId, GENRE_SAVE_LINE);
    });
    return null;
  } catch (error) {
    const kind = failureKind(error);
    if (kind === "book") {
      deps.repo.recordGenreRejection({ workId, ...strikeReason(error), at: at() });
      return null;
    }
    if (kind === "budget") return nextUtcMidnight(deps.now());
    if (kind === "outage") return deps.now() + OUTAGE_PAUSE_MS;
    if (kind === "key") {
      deps.alert("TypeSafe rejected the genre requests", "TypeSafe answered 401, so genre judgments are paused for a day. Check TYPESAFE_API_KEY.");
      return deps.now() + KEY_PAUSE_MS;
    }
    throw error;
  }
}

function heldCanonical(deps: HeldDeps): Set<string> {
  return new Set(deps.repo.canonicalWorkIds(deps.heldWorkIds()).values());
}

export async function judgeWork(deps: HeldDeps, workId: string, held: () => Set<string> = () => heldCanonical(deps)): Promise<number | null> {
  const canonical = deps.repo.canonicalWorkIds([workId]).get(workId);
  if (!canonical || !held().has(canonical)) return null;
  if (deps.repo.worksNeedingGenreJudgment([canonical], 1, GENRE_REJECTION_LIMIT).length === 0) return null;
  return classifyWork(deps, canonical);
}

type Timers = Parameters<typeof startDetailsBackfill>[3];

export function startGenreJobs(
  deps: HeldDeps & { onError: (error: unknown, workId?: string) => void; info: (details: object, message: string) => void; timers?: Timers }
): GenreJobs {
  let alertQuietUntil = 0;
  let budgetLoggedUntil = 0;
  const alert = (subject: string, text: string) => {
    if (deps.now() < alertQuietUntil) return;
    alertQuietUntil = deps.now() + KEY_PAUSE_MS;
    deps.alert(subject, text);
  };
  const classify: ClassifyGenre = async (book) => {
    try {
      return await deps.classify(book);
    } catch (error) {
      if (error instanceof TypesafeBudgetSpentError && deps.now() >= budgetLoggedUntil) {
        budgetLoggedUntil = nextUtcMidnight(deps.now());
        deps.info({ until: new Date(budgetLoggedUntil).toISOString() }, "genre judgments paused until the daily TypeSafe budget resets");
      }
      throw error;
    }
  };
  let heldSince = 0;
  let heldSet: Set<string> | null = null;
  const refreshHeld = () => {
    heldSet = heldCanonical(deps);
    heldSince = deps.now();
    return heldSet;
  };
  const held = () => (!heldSet || deps.now() - heldSince >= HELD_CACHE_MS ? refreshHeld() : heldSet);
  const judged = { ...deps, alert, classify };
  const queue = createWorkQueue({ concurrency: GENRE_IN_FLIGHT, now: deps.now, run: (workId) => judgeWork(judged, workId, held), onError: deps.onError });
  const stopSweep = startDetailsBackfill(
    async () => {
      deps.repo.applyGenreJudgments(GENRE_SAVE_LINE);
      const sweepHeld = [...refreshHeld()];
      for (const workId of deps.repo.worksNeedingGenreJudgment(sweepHeld, GENRE_SWEEP_LIMIT, GENRE_REJECTION_LIMIT)) queue.add(workId);
      return null;
    },
    (error) => deps.onError(error),
    GENRE_SWEEP_INTERVAL_MS,
    deps.timers
  );
  return {
    add: (workId) => queue.add(workId),
    stop: () => {
      stopSweep();
      queue.stop();
    }
  };
}

export function startGenreJobsIfConfigured(apiKey: string, deps: Omit<Parameters<typeof startGenreJobs>[0], "classify">): GenreJobs | null {
  if (apiKey === "") return null;
  return startGenreJobs({ ...deps, classify: createJevGenreClassifier(apiKey, dailySpend(deps.repo, GENRE_SOURCE, GENRE_DAILY_BUDGET, deps.now)) });
}
