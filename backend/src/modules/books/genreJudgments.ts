import type { ClassifyGenre, JevBook } from "./adapters/typesafe/jevGenres.js";
import { SourceUnavailableError } from "./domain/errors.js";
import type { BooksRepository } from "./domain/ports.js";
import type { GenreEvidence } from "./domain/types.js";
import { longestSynopsis } from "./genrePass.js";

export const GENRE_SAVE_LINE = 0.5;
export const GENRE_SOURCE = "genres";
export const GENRE_DAILY_BUDGET = 1000;
export const GENRE_REJECTION_LIMIT = 3;
export const GENRE_JUDGMENT_BATCH = 50;
const IN_FLIGHT = 4;
const KEY_PAUSE_MS = 24 * 60 * 60 * 1000;

export type GenreJudgmentDeps = {
  repo: BooksRepository;
  classify: ClassifyGenre;
  heldWorkIds: () => string[];
  now: () => number;
  alert: (subject: string, text: string) => void;
};

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

export async function judgeGenres(deps: GenreJudgmentDeps, limit: number, signal: AbortSignal): Promise<number | null> {
  const held = [...new Set(deps.repo.canonicalWorkIds(deps.heldWorkIds()).values())];
  const workIds = deps.repo.worksNeedingGenreJudgment(held, limit, GENRE_REJECTION_LIMIT);
  const failures: unknown[] = [];
  let next = 0;
  const worker = async () => {
    while (failures.length === 0 && !signal.aborted && next < workIds.length) {
      const workId = workIds[next++]!;
      const evidence = deps.repo.genreEvidence(workId);
      if (!evidence) continue;
      try {
        const judgment = await deps.classify(jevBookOf(evidence));
        deps.repo.saveGenreJudgment({ workId, model: judgment.model, genre: judgment.genre, confidence: judgment.confidence, askedAt: new Date(deps.now()).toISOString() });
      } catch (error) {
        failures.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: IN_FLIGHT }, worker));
  deps.repo.applyGenreJudgments(GENRE_SAVE_LINE);
  if (failures.length === 0) return null;
  const [failure] = failures;
  if (failure instanceof SourceUnavailableError && (failure.status === 401 || failure.status === 422)) {
    deps.alert("TypeSafe rejected the genre requests", `TypeSafe answered ${failure.status}, so genre judgments are paused for a day. Check TYPESAFE_API_KEY.`);
    return deps.now() + KEY_PAUSE_MS;
  }
  throw failure;
}
