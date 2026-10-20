import { WorkMergeError } from "./domain/errors.js";
import type { BooksRepository } from "./domain/ports.js";
import { hasVolumeMarker, seriesLikeOriginals } from "./domain/translation.js";

const SOURCES = ["code", "jev", "manual"] as const;

type Source = (typeof SOURCES)[number];
type Why = "series-like" | "volume";
type Edition = ReturnType<BooksRepository["editionsOf"]>[number];
type ListRepo = Pick<BooksRepository, "activeMerges" | "editionsOf" | "originalTitleClaims" | "canonicalWorkIds" | "getWorkView">;
type UndoRepo = Pick<BooksRepository, "activeMerges" | "transaction" | "undoMerge" | "saveWorkMatchJudgment">;

export type SeriesCollapse = {
  intoWork: string;
  title: string;
  author: string;
  editions: Array<{ title: string; language: string | null; isbn: string | null; originalTitle: string | null }>;
  joined: Array<{
    fromWork: string;
    mergeId: number;
    source: Source;
    editions: Array<{ title: string; isbn: string | null; originalTitle: string | null }>;
    why: Why | null;
  }>;
};

export function listSeriesCollapses(repo: ListRepo): SeriesCollapse[] {
  const isSeriesLike = seriesLikeOriginals(repo.originalTitleClaims());
  const merges = SOURCES.flatMap((source) => repo.activeMerges(source).map((merge) => ({ ...merge, source }))).sort((a, b) => a.id - b.id);
  const live = repo.canonicalWorkIds(merges.map((merge) => merge.intoWork));
  const editionsByWork = new Map<string, Edition[]>();
  for (const edition of repo.editionsOf([...new Set(live.values())])) editionsByWork.set(edition.workId, [...(editionsByWork.get(edition.workId) ?? []), edition]);
  const joins = merges.map((merge) => {
    const current = live.get(merge.intoWork) ?? merge.intoWork;
    const moved = new Set(merge.movedBookIds);
    const editions = (editionsByWork.get(current) ?? []).filter((edition) => moved.has(edition.id));
    const why: Why | null = editions.some((edition) => edition.originalTitle !== null && isSeriesLike(edition.originalTitle, edition.author)) ? "series-like" : editions.some((edition) => hasVolumeMarker(edition.title)) ? "volume" : null;
    return { merge, current, editions, why };
  });
  const targets = new Set(joins.filter((join) => join.merge.source === "code" && join.why !== null).map((join) => join.merge.intoWork));
  return [...targets].map((intoWork) => {
    const own = joins.filter((join) => join.merge.intoWork === intoWork);
    const current = own[0]!.current;
    const joinedIds = new Set(own.flatMap((join) => join.merge.movedBookIds));
    const work = repo.getWorkView(current)!;
    return {
      intoWork,
      title: work.title,
      author: work.author,
      editions: (editionsByWork.get(current) ?? []).filter((edition) => !joinedIds.has(edition.id)).map((edition) => ({ title: edition.title, language: edition.language, isbn: edition.isbn, originalTitle: edition.originalTitle })),
      joined: own.map((join) => ({
        fromWork: join.merge.fromWork,
        mergeId: join.merge.id,
        source: join.merge.source,
        editions: join.editions.map((edition) => ({ title: edition.title, isbn: edition.isbn, originalTitle: edition.originalTitle })),
        why: join.why
      }))
    };
  });
}

export function undoReviewedMerges(repo: UndoRepo, fromWorks: string[], now: () => number): { undone: number; failures: Array<{ fromWork: string; reason: string }> } {
  const reviewed = new Set(fromWorks);
  const merges = [...repo.activeMerges("code"), ...repo.activeMerges("jev")].filter((merge) => reviewed.has(merge.fromWork)).sort((a, b) => b.id - a.id);
  const failures: Array<{ fromWork: string; reason: string }> = [];
  let undone = 0;
  for (const { fromWork } of merges) {
    const at = new Date(now()).toISOString();
    try {
      repo.transaction(() => {
        repo.undoMerge(fromWork, at);
        repo.saveWorkMatchJudgment(fromWork, { model: "code", intoWorkId: null, confidence: null, askedAt: at });
      });
      undone += 1;
    } catch (error) {
      if (!(error instanceof WorkMergeError)) throw error;
      failures.push({ fromWork, reason: error.message });
    }
  }
  return { undone, failures };
}
