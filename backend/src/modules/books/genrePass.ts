import { BOOK_GENRES } from "@scripta/shared";
import type { BooksRepository } from "./domain/ports.js";
import type { GenreEvidence } from "./domain/types.js";
import { catalogGenresWith } from "./works.js";

export const SYNOPSIS_LIMIT = 1200;
const EDITION_LIMIT = 4;
const KNOWN_GENRES = new Set<string>(BOOK_GENRES);

export const GENRE_SAVE_LINE = 0.5;
export const GENRE_LABEL_MAX = 3;

export function labelProblem(genres: unknown[]): string | null {
  const unknown = genres.filter((genre) => typeof genre !== "string" || !KNOWN_GENRES.has(genre));
  if (unknown.length > 0) return `has unknown genres: ${unknown.join(", ")}`;
  if (new Set(genres).size !== genres.length) return "repeats a genre";
  if (genres.length > GENRE_LABEL_MAX) return `has more than ${GENRE_LABEL_MAX} genres`;
  return null;
}

export function labelWork(books: BooksRepository, workId: string, genres: string[], at: string): number {
  if (genres.length > 0) return books.setManualGenres(workId, genres);
  books.transaction(() => {
    books.saveGenreJudgment({ workId, model: "manual", genre: null, confidence: 1, askedAt: at });
    books.applyGenreJudgment(workId, GENRE_SAVE_LINE);
  });
  return 0;
}

export type HeldWork = { workId: string; holders: number; finished: boolean };
export type GenrePassWork = {
  workId: string;
  title: string;
  author: string;
  editions: Array<{ title: string; language: string | null; isbn: string | null; publisher: string | null; year: number | null }>;
  synopsis: string | null;
  finished: boolean;
  holders: number;
  jev: { genre: string | null; confidence: number } | null;
};
export type GenreImportReport = { works: number; editions: number; skipped: string[] };

export class GenreLabelsError extends Error {}

export function longestSynopsis(evidence: GenreEvidence): string | null {
  const texts = [evidence.work.summary, ...evidence.editions.map((edition) => edition.summary)].filter((text): text is string => Boolean(text?.trim()));
  const longest = texts.sort((a, b) => b.length - a.length)[0];
  return longest ? longest.slice(0, SYNOPSIS_LIMIT) : null;
}

export function genrePassWorksWith(books: BooksRepository, held: HeldWork[]): GenrePassWork[] {
  const canonical = books.canonicalWorkIds(held.map((work) => work.workId));
  const merged = new Map<string, { holders: number; finished: boolean }>();
  for (const work of held) {
    const id = canonical.get(work.workId);
    if (!id) continue;
    const entry = merged.get(id) ?? { holders: 0, finished: false };
    merged.set(id, { holders: entry.holders + work.holders, finished: entry.finished || work.finished });
  }
  const genres = catalogGenresWith(books, [...merged.keys()]);
  const judgments = books.genreJudgments([...merged.keys()]);
  return [...merged]
    .flatMap(([workId, entry]) => {
      const judgment = judgments.get(workId);
      if (judgment?.model === "manual") return [];
      const evidence = (genres.get(workId)?.genres.length ?? 0) > 0 ? undefined : books.genreEvidence(workId);
      if (!evidence) return [];
      const editions = [...new Map(evidence.editions.map((edition) => [`${edition.title}|${edition.language}|${edition.isbn}`, { title: edition.title, language: edition.language, isbn: edition.isbn, publisher: edition.publisher, year: edition.year }])).values()].slice(0, EDITION_LIMIT);
      return [{ workId, title: evidence.work.title, author: evidence.work.author, editions, synopsis: longestSynopsis(evidence), ...entry, jev: judgment ? { genre: judgment.genre, confidence: judgment.confidence } : null }];
    })
    .sort((a, b) => Number(b.finished) - Number(a.finished) || b.holders - a.holders || a.title.localeCompare(b.title));
}

export function catalogDoubtsWith(books: BooksRepository, held: HeldWork[]): GenrePassWork[] {
  const judged = new Set(books.canonicalWorkIds(books.jevJudgedWorkIds()).values());
  const canonical = books.canonicalWorkIds(held.map((work) => work.workId));
  const heldJudged = held.filter((work) => judged.has(canonical.get(work.workId)!));
  const heldIds = new Set(heldJudged.map((work) => canonical.get(work.workId)));
  const others = [...judged].filter((workId) => !heldIds.has(workId)).map((workId) => ({ workId, holders: 0, finished: false }));
  return genrePassWorksWith(books, [...heldJudged, ...others]);
}

function labelsOf(input: unknown): Array<{ workId: string; genres: string[] }> {
  if (!Array.isArray(input)) throw new GenreLabelsError("The labels file must be a JSON array of { workId, genres }.");
  const problems: string[] = [];
  const labels = input.flatMap((label: unknown, index) => {
    const workId = (label as { workId?: unknown } | null)?.workId;
    const genres = (label as { genres?: unknown } | null)?.genres;
    if (typeof workId !== "string" || !Array.isArray(genres)) {
      problems.push(`Label ${index} needs a workId and a genres array.`);
      return [];
    }
    const problem = labelProblem(genres);
    if (problem) problems.push(`Label ${index} (${workId}) ${problem}`);
    return [{ workId, genres: genres as string[] }];
  });
  if (problems.length > 0) throw new GenreLabelsError(problems.join("\n"));
  return labels;
}

export function importGenreLabelsWith(books: BooksRepository, input: unknown): GenreImportReport {
  const labels = labelsOf(input);
  const canonical = books.canonicalWorkIds(labels.map((label) => label.workId));
  const missing = labels.filter((label) => !canonical.has(label.workId)).map((label) => label.workId);
  if (missing.length > 0) throw new GenreLabelsError(`Unknown works: ${missing.join(", ")}`);
  return books.transaction(() => {
    const report: GenreImportReport = { works: 0, editions: 0, skipped: [] };
    for (const label of labels) {
      const workId = canonical.get(label.workId)!;
      const changed = labelWork(books, workId, label.genres, new Date().toISOString());
      if (changed === 0) report.skipped.push(label.workId);
      else {
        report.works += 1;
        report.editions += changed;
      }
    }
    return report;
  });
}
