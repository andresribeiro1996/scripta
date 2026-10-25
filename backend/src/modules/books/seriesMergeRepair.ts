import { WorkMergeError } from "./domain/errors.js";
import type { BooksRepository } from "./domain/ports.js";
import { seriesNameKey, type SeriesSource } from "./domain/series.js";
import { hasVolumeMarker, seriesLikeOriginals } from "./domain/translation.js";
import type { MergeSource } from "./domain/types.js";
import { joinVerdict } from "./domain/volumeGuard.js";
import { guardTarget } from "./translationJudgments.js";

const SOURCES: MergeSource[] = ["title-key", "admin", "code", "jev", "manual", "ol-duplicate"];
const UNDOABLE: MergeSource[] = ["code", "jev", "manual", "ol-duplicate", "title-key"];

type Why = "series-like" | "volume";
type Edition = ReturnType<BooksRepository["editionsOf"]>[number];
type Merge = ReturnType<BooksRepository["activeMerges"]>[number] & { source: MergeSource };
type ListRepo = Pick<BooksRepository, "activeMerges" | "editionsOf" | "originalTitleClaims" | "canonicalWorkIds" | "getWorkView">;
type UndoRepo = Pick<BooksRepository, "activeMerges" | "transaction" | "undoMerge" | "saveWorkMatchJudgment">;
type GuardRepo = Pick<BooksRepository, "activeMerges" | "editionsOf" | "canonicalWorkIds" | "getWorkView" | "collectionsOf" | "seriesMemberKind" | "seriesPositionsOf">;
type Failure = { fromWork: string; reason: string };

export type SeriesCollapse = {
  intoWork: string;
  title: string;
  author: string;
  editions: Array<{ title: string; language: string | null; isbn: string | null; originalTitle: string | null }>;
  joined: Array<{
    fromWork: string;
    mergeId: number;
    source: MergeSource;
    editions: Array<{ title: string; isbn: string | null; originalTitle: string | null }>;
    why: Why | null;
  }>;
  downstream: Array<{ mergeId: number; fromWork: string; intoWork: string; source: MergeSource }>;
};

function allActiveMerges(repo: Pick<BooksRepository, "activeMerges">): Merge[] {
  return SOURCES.flatMap((source) => repo.activeMerges(source).map((merge) => ({ ...merge, source }))).sort((a, b) => a.id - b.id);
}

function onwardFrom(byFrom: Map<string, Merge>, work: string): Merge[] {
  const chain: Merge[] = [];
  for (let step = byFrom.get(work); step; step = byFrom.get(step.intoWork)) chain.push(step);
  return chain;
}

export function listSeriesCollapses(repo: ListRepo): SeriesCollapse[] {
  const isSeriesLike = seriesLikeOriginals(repo.originalTitleClaims());
  const merges = allActiveMerges(repo);
  const byFrom = new Map(merges.map((merge) => [merge.fromWork, merge]));
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
      })),
      downstream: onwardFrom(byFrom, intoWork).map((step) => ({ mergeId: step.id, fromWork: step.fromWork, intoWork: step.intoWork, source: step.source }))
    };
  });
}

export type GuardedMerge = {
  mergeId: number;
  fromWork: string;
  intoWork: string;
  source: "code" | "jev";
  confidence: number | null;
  verdict: "review" | "never";
  intoTitle: string;
  editions: Array<{ title: string; isbn: string | null; originalTitle: string | null; collections: string[] }>;
  later: Array<{ mergeId: number; fromWork: string; source: MergeSource; editions: Array<{ title: string; isbn: string | null; originalTitle: string | null }> }>;
};

export function listGuardedMerges(repo: GuardRepo): { checked: number; skipped: number[]; flagged: GuardedMerge[] } {
  const merges = allActiveMerges(repo);
  const live = repo.canonicalWorkIds(merges.map((merge) => merge.intoWork));
  const editionsByWork = new Map<string, Edition[]>();
  for (const edition of repo.editionsOf([...new Set(live.values())])) editionsByWork.set(edition.workId, [...(editionsByWork.get(edition.workId) ?? []), edition]);
  const movedEditions = (merge: Merge) => {
    const moved = new Set(merge.movedBookIds);
    return (editionsByWork.get(live.get(merge.intoWork) ?? merge.intoWork) ?? []).filter((edition) => moved.has(edition.id));
  };
  const candidates = merges.filter((merge): merge is Merge & { source: "code" | "jev" } => merge.source === "code" || merge.source === "jev");
  const flagged: GuardedMerge[] = [];
  const skipped: number[] = [];
  const filled = (values: Array<string | null>) => values.find((value): value is string => Boolean(value?.trim())) ?? null;
  for (const merge of candidates) {
    const current = live.get(merge.intoWork) ?? merge.intoWork;
    const editions = movedEditions(merge);
    const target = repo.getWorkView(current);
    if (editions.length === 0 || !target) {
      skipped.push(merge.id);
      continue;
    }
    const guard = guardTarget(repo, target.title, current);
    const verdict = joinVerdict({ title: filled(editions.map((edition) => edition.title)) ?? "" }, guard.target, guard.memberKind);
    if (verdict === "join") continue;
    const collections = repo.collectionsOf(editions.map((edition) => edition.id));
    flagged.push({
      mergeId: merge.id,
      fromWork: merge.fromWork,
      intoWork: merge.intoWork,
      source: merge.source,
      confidence: merge.confidence,
      verdict,
      intoTitle: target.title,
      editions: editions.map((edition) => {
        const entry = collections.get(edition.id);
        return { title: edition.title, isbn: edition.isbn, originalTitle: edition.originalTitle, collections: entry ? [entry.position === null ? entry.name : `${entry.name}#${entry.position}`] : [] };
      }),
      later: merges
        .filter((other) => other.id > merge.id && (live.get(other.intoWork) ?? other.intoWork) === current)
        .map((other) => ({ mergeId: other.id, fromWork: other.fromWork, source: other.source, editions: movedEditions(other).map((edition) => ({ title: edition.title, isbn: edition.isbn, originalTitle: edition.originalTitle })) }))
    });
  }
  return { checked: candidates.length - skipped.length, skipped, flagged };
}

export function dropSeriesRows(repo: Pick<BooksRepository, "removeWorkSeries">, rows: Array<{ workId: string; name: string; source: SeriesSource }>): number {
  let dropped = 0;
  for (const row of rows) {
    const nameKey = seriesNameKey(row.name);
    if (nameKey) dropped += repo.removeWorkSeries(row.workId, nameKey, row.source);
  }
  return dropped;
}

export function addSeriesRows(repo: Pick<BooksRepository, "addWorkSeries">, rows: Array<{ workId: string; name: string; position: string | null; source: SeriesSource }>, at: string): number {
  return rows.reduce((added, row) => added + repo.addWorkSeries(row.workId, [{ name: row.name, position: row.position }], row.source, at), 0);
}

export function undoReviewedMerges(repo: UndoRepo, fromWorks: string[], now: () => number, progress: (fromWork: string) => void): { undone: string[]; failures: Failure[] } {
  const reviewed = new Set(fromWorks);
  const merges = allActiveMerges(repo);
  const byFrom = new Map(merges.map((merge) => [merge.fromWork, merge]));
  const requested = merges.filter((merge) => UNDOABLE.includes(merge.source) && reviewed.has(merge.fromWork));
  const queued = new Set(requested.map((merge) => merge.id));
  const found = new Set(requested.map((merge) => merge.fromWork));
  const failures: Failure[] = [...reviewed].filter((fromWork) => !found.has(fromWork)).map((fromWork) => ({ fromWork, reason: "no active code, jev, manual, ol-duplicate or title-key merge" }));
  const undone: string[] = [];
  for (const { fromWork, intoWork, source } of requested.sort((a, b) => b.id - a.id)) {
    const blocker = onwardFrom(byFrom, intoWork).find((step) => !queued.has(step.id));
    if (blocker) {
      failures.push({ fromWork, reason: `its target ${intoWork} was joined onward by a ${blocker.source} join (${blocker.fromWork} to ${blocker.intoWork}) that is not being undone` });
      continue;
    }
    const at = new Date(now()).toISOString();
    try {
      repo.transaction(() => {
        repo.undoMerge(fromWork, at);
        if (source !== "title-key") repo.saveWorkMatchJudgment(fromWork, { model: "manual", intoWorkId: null, confidence: null, askedAt: at });
      });
    } catch (error) {
      if (!(error instanceof WorkMergeError)) throw error;
      failures.push({ fromWork, reason: error.message });
      continue;
    }
    undone.push(fromWork);
    progress(fromWork);
  }
  return { undone, failures };
}
