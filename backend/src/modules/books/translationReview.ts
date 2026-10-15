import type { TranslationReview, TranslationReviewAction, TranslationReviewItem } from "@scripta/shared";
import { BookNotFoundError, WorkMergeError } from "./domain/errors.js";
import type { BooksRepository } from "./domain/ports.js";
import { MATCH_MERGE_AT, MATCH_REVIEW_AT } from "./domain/translation.js";
import type { HeldWork } from "./genrePass.js";

export const TRANSLATION_REVIEW_LIMIT = 200;
const EXCERPT_LIMIT = 300;
const GROUP_ORDER = { possible: 0, blocked: 1, merged: 2 } as const;

export function translationReviewWith(books: BooksRepository, held: HeldWork[], coverUrl: (imageId: string) => string): TranslationReview {
  const rows = books.translationReviewRows(MATCH_MERGE_AT, MATCH_REVIEW_AT);
  const live = books.canonicalWorkIds(rows.map((row) => row.intoWorkId));
  const liveInto = (row: { intoWorkId: string }) => live.get(row.intoWorkId) ?? row.intoWorkId;
  const works = books.translationReviewWorks([...new Set(rows.map((row) => row.workId))]);
  const originals = new Map(books.matchCandidates([...new Set(rows.map(liveInto))]).map((candidate) => [candidate.id, candidate]));
  const canonical = books.canonicalWorkIds(held.map((work) => work.workId));
  const holding = new Map<string, { holders: number; finished: boolean }>();
  for (const work of held) {
    const id = canonical.get(work.workId) ?? work.workId;
    const seen = holding.get(id);
    holding.set(id, { holders: (seen?.holders ?? 0) + work.holders, finished: (seen?.finished ?? false) || work.finished });
  }
  const listed = rows.flatMap((row): TranslationReviewItem[] => {
    const own = works.get(row.workId);
    const target = originals.get(liveInto(row));
    if (!own || !target) return [];
    const holder = holding.get(row.group === "merged" ? liveInto(row) : row.workId);
    return [{
      workId: row.workId,
      title: own.title,
      author: own.author,
      originalTitle: own.originalTitle,
      coverUrl: own.coverImageId ? coverUrl(own.coverImageId) : null,
      synopsis: own.synopsis?.slice(0, EXCERPT_LIMIT) ?? null,
      holders: holder?.holders ?? 0,
      finished: holder?.finished ?? false,
      proposed: { workId: target.id, title: target.title, author: target.author, year: target.year, editions: target.editions, languages: target.languages },
      group: row.group,
      evidence: { model: row.model, confidence: row.confidence },
      mergedAt: row.mergedAt
    }];
  });
  listed.sort((a, b) => Number(b.finished) - Number(a.finished) || b.holders - a.holders || GROUP_ORDER[a.group] - GROUP_ORDER[b.group] || (b.mergedAt ?? "").localeCompare(a.mergedAt ?? "") || a.title.localeCompare(b.title));
  return { items: listed.slice(0, TRANSLATION_REVIEW_LIMIT), total: listed.length };
}

export function reviewTranslationWith(deps: { repo: BooksRepository; sharesArena: (from: string, into: string) => boolean; now: () => number }, workId: string, action: TranslationReviewAction): { workId: string } {
  if (!deps.repo.translationEvidence(workId)) throw new BookNotFoundError();
  const at = new Date(deps.now()).toISOString();
  const none = { model: "manual", intoWorkId: null, confidence: null, askedAt: at };
  if ("merge" in action) {
    if (deps.sharesArena(workId, action.merge)) throw new WorkMergeError("Both works are in an arena.");
    deps.repo.transaction(() => {
      deps.repo.saveWorkMatchJudgment(workId, { model: "manual", intoWorkId: action.merge, confidence: null, askedAt: at });
      deps.repo.mergeTranslation(workId, action.merge, "manual", null, at);
    });
    return { workId };
  }
  if ("undo" in action) {
    deps.repo.transaction(() => {
      deps.repo.undoMerge(workId, at);
      deps.repo.saveWorkMatchJudgment(workId, none);
    });
    return { workId };
  }
  deps.repo.saveWorkMatchJudgment(workId, none);
  return { workId };
}
