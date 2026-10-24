import { createJevGenreClassifier, type ClassifyGenre, type JevBook } from "./adapters/typesafe/jevGenres.js";
import type { BooksRepository } from "./domain/ports.js";
import type { GenreEvidence } from "./domain/types.js";
import { GENRE_SAVE_LINE, longestSynopsis } from "./genrePass.js";
import { heldCanonical, JEV_SWEEP_LIMIT, jevPause, startJevJobs, type JevJobs, type JevJobsDeps, type JevPauseDeps } from "./jevJobs.js";
import { dailySpend } from "./typesafe.js";

export { GENRE_SAVE_LINE };
export const GENRE_SOURCE = "genres";
export const GENRE_DAILY_BUDGET = 1000;
export const GENRE_REJECTION_LIMIT = 3;

const GENRE_KEY_ALERT = { subject: "TypeSafe rejected the genre requests", text: "TypeSafe answered 401, so genre judgments are paused for a day. Check TYPESAFE_API_KEY." };

export type GenreJudgmentDeps = JevPauseDeps & { repo: BooksRepository; classify: ClassifyGenre };
type HeldDeps = GenreJudgmentDeps & { heldWorkIds: () => string[] };
export type GenreJobs = JevJobs;

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
    return jevPause(error, deps, GENRE_KEY_ALERT, (strike) => deps.repo.recordGenreRejection({ workId, ...strike, at: at() }));
  }
}

export async function judgeWork(deps: HeldDeps, workId: string, held: () => Set<string> = () => heldCanonical(deps.repo, deps.heldWorkIds())): Promise<number | null> {
  const canonical = deps.repo.canonicalWorkIds([workId]).get(workId);
  if (!canonical || !held().has(canonical)) return null;
  if (deps.repo.worksNeedingGenreJudgment([canonical], 1, GENRE_REJECTION_LIMIT).length === 0) return null;
  return classifyWork(deps, canonical);
}

export function startGenreJobs(deps: JevJobsDeps & { repo: BooksRepository; classify: ClassifyGenre }): GenreJobs {
  return startJevJobs(deps, {
    source: GENRE_SOURCE,
    budgetMessage: "genre judgments paused until the daily TypeSafe budget resets",
    sweep: (held) => deps.repo.worksNeedingGenreJudgment(held, JEV_SWEEP_LIMIT, GENRE_REJECTION_LIMIT),
    judge: (workId, held, pause) => judgeWork({ ...deps, ...pause }, workId, held)
  });
}

export function startGenreJobsIfConfigured(apiKey: string, deps: Omit<Parameters<typeof startGenreJobs>[0], "classify">): GenreJobs | null {
  if (apiKey === "") return null;
  return startGenreJobs({ ...deps, classify: createJevGenreClassifier(apiKey, dailySpend(deps.repo, GENRE_SOURCE, GENRE_DAILY_BUDGET, deps.now)) });
}
