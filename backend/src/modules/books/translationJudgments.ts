import { createJevMatchClassifier, type ClassifyMatch } from "./adapters/typesafe/jevWorkMatch.js";
import { startDetailsBackfill } from "./backfill.js";
import { WorkMergeError } from "./domain/errors.js";
import type { BooksRepository } from "./domain/ports.js";
import { authorPattern, evidenceOf, hasVolumeMarker, MATCH_MERGE_AT, MAX_CANDIDATES, mentionsSurname, sameMainTitle, sameWholeTitle, seriesLikeOriginals, surnameOf, titlePatterns, type SeriesLike, type TranslationEvidence } from "./domain/translation.js";
import { JEV_REJECTION_LIMIT } from "./jevJobs.js";
import { dailySpend, failureKind, nextUtcMidnight, strikeReason } from "./typesafe.js";
import { createWorkQueue } from "./workQueue.js";

export type MatchCandidate = { id: string; title: string; author: string; year: number | null };
export type MatchPlan = { kind: "original" } | { kind: "none" } | { kind: "code"; intoWorkId: string } | { kind: "ask"; evidence: TranslationEvidence; candidates: MatchCandidate[] };

type PlanRepo = Pick<BooksRepository, "translationEvidence" | "titleCandidates" | "authorCandidates" | "matchCandidates">;

export function titleCandidateRows(repo: Pick<BooksRepository, "titleCandidates">, original: string, workId: string): Array<{ id: string; title: string }> {
  return titlePatterns(original).flatMap((pattern) => repo.titleCandidates(pattern)).filter((row) => row.id !== workId);
}

export function planMatch(repo: PlanRepo, workId: string, isSeriesLike: SeriesLike): MatchPlan | null {
  const rows = repo.translationEvidence(workId);
  if (!rows || rows.editions.length === 0) return null;
  const evidence = evidenceOf(rows);
  if (evidence.originalTitle && sameMainTitle(evidence.originalTitle, evidence.title)) return { kind: "original" };
  if (evidence.originalTitle && isSeriesLike(evidence.originalTitle, evidence.workAuthor || evidence.author)) return { kind: "none" };
  const original = evidence.originalTitle;
  const titleRows = original ? titleCandidateRows(repo, original, workId) : [];
  const byTitle = [...new Set(titleRows.map((row) => row.id))];
  const byAuthorPattern = authorPattern(evidence.workAuthor || evidence.author);
  const byAuthor = byAuthorPattern ? repo.authorCandidates(byAuthorPattern).filter((id) => id !== workId && !byTitle.includes(id)) : [];
  if (byTitle.length === 0 && byAuthor.length === 0) return { kind: "none" };
  if (original && !hasVolumeMarker(original) && !hasVolumeMarker(evidence.title)) {
    const whole = titleRows.filter((row) => sameWholeTitle(row.title, original)).map((row) => row.id);
    const vouched = repo.matchCandidates(whole).filter((candidate) => {
      const surname = surnameOf(candidate.author);
      return surname !== null && mentionsSurname([evidence.workAuthor, evidence.author, ...evidence.summaries], surname);
    });
    if (vouched.length === 1) return { kind: "code", intoWorkId: vouched[0]!.id };
  }
  const ids = [...byTitle, ...byAuthor].slice(0, MAX_CANDIDATES);
  const details = new Map(repo.matchCandidates(ids).map((candidate) => [candidate.id, candidate]));
  const candidates = ids.flatMap((id) => {
    const candidate = details.get(id);
    return candidate ? [{ id, title: candidate.title, author: candidate.author, year: candidate.year }] : [];
  });
  return { kind: "ask", evidence, candidates };
}

const OUTAGE_PAUSE_MS = 10 * 60 * 1000;
const KEY_PAUSE_MS = 24 * 60 * 60 * 1000;

export function arenaCheck(repo: Pick<BooksRepository, "canonicalWorkIds" | "aliasesOf">, worksShareAnArena: (aIds: string[], bIds: string[]) => boolean): (fromWorkId: string, intoWorkId: string) => boolean {
  const ids = (id: string) => {
    const live = repo.canonicalWorkIds([id]).get(id) ?? id;
    return [live, ...repo.aliasesOf([live])];
  };
  return (fromWorkId, intoWorkId) => worksShareAnArena(ids(fromWorkId), ids(intoWorkId));
}

export type TranslationDeps = {
  repo: BooksRepository;
  classify: ClassifyMatch;
  sharesArena: (fromWorkId: string, intoWorkId: string) => boolean;
  now: () => number;
  alert: (subject: string, text: string) => void;
};

function decide(deps: TranslationDeps, workId: string, model: string, intoWorkId: string | null, confidence: number | null, merge: boolean, at: string) {
  try {
    deps.repo.transaction(() => {
      deps.repo.saveWorkMatchJudgment(workId, { model, intoWorkId, confidence, askedAt: at });
      deps.repo.clearJevRejection("works", workId);
      if (merge && intoWorkId && !deps.sharesArena(workId, intoWorkId)) deps.repo.mergeTranslation(workId, intoWorkId, model === "code" ? "code" : "jev", confidence, at);
    });
  } catch (error) {
    if (!(error instanceof WorkMergeError)) throw error;
  }
}

export async function matchWork(deps: TranslationDeps, workId: string, isSeriesLike: SeriesLike): Promise<number | null> {
  const at = () => new Date(deps.now()).toISOString();
  const plan = planMatch(deps.repo, workId, isSeriesLike);
  if (!plan) return null;
  if (plan.kind === "original" || plan.kind === "none") {
    decide(deps, workId, "code", null, null, false, at());
    return null;
  }
  if (plan.kind === "code") {
    decide(deps, workId, "code", plan.intoWorkId, null, true, at());
    return null;
  }
  try {
    const { evidence, candidates } = plan;
    const answer = await deps.classify({ edition: { title: evidence.title, author: evidence.author, originalTitle: evidence.originalTitle, publisher: evidence.publisher, description: evidence.summary }, candidates });
    const into = answer.choice === null ? null : candidates[answer.choice]!.id;
    decide(deps, workId, answer.model, into, answer.confidence, answer.confidence >= MATCH_MERGE_AT, at());
    return null;
  } catch (error) {
    const kind = failureKind(error);
    if (kind === "book") {
      deps.repo.recordJevRejection({ task: "works", subject: workId, ...strikeReason(error), at: at() });
      return null;
    }
    if (kind === "budget") return nextUtcMidnight(deps.now());
    if (kind === "outage") return deps.now() + OUTAGE_PAUSE_MS;
    if (kind === "key") {
      deps.alert("TypeSafe rejected the translation requests", "TypeSafe answered 401, so translation matching is paused for a day. Check TYPESAFE_API_KEY.");
      return deps.now() + KEY_PAUSE_MS;
    }
    throw error;
  }
}

export const WORK_MATCH_SOURCE = "works";
export const WORK_MATCH_DAILY_BUDGET = 1000;
const IN_FLIGHT = 4;
const SWEEP_LIMIT = 1000;
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const HELD_CACHE_MS = 60 * 1000;
const SERIES_LIKE_CACHE_MS = 10 * 60 * 1000;

type HeldDeps = TranslationDeps & { heldWorkIds: () => string[] };
export type TranslationJobs = { add(workId: string): void; stop(): void };

function heldCanonical(deps: HeldDeps): Set<string> {
  return new Set(deps.repo.canonicalWorkIds(deps.heldWorkIds()).values());
}

export async function judgeWorkMatch(deps: HeldDeps, workId: string, held: () => Set<string> = () => heldCanonical(deps), seriesLike: () => SeriesLike = () => seriesLikeOriginals(deps.repo.originalTitleClaims())): Promise<number | null> {
  const canonical = deps.repo.canonicalWorkIds([workId]).get(workId);
  if (!canonical || !held().has(canonical)) return null;
  if (deps.repo.portugueseWorksNeedingMatch([canonical], 1, JEV_REJECTION_LIMIT, null).length === 0) return null;
  deps.repo.fillOriginalTitlesFromSummaries(canonical);
  return matchWork(deps, canonical, seriesLike());
}

export function startTranslationJobs(deps: HeldDeps & { info: (details: Record<string, unknown>, message: string) => void; onError: (error: unknown, workId?: string) => void; initialDelayMs?: number }): TranslationJobs {
  let quietUntil = 0;
  let budgetLoggedUntil = 0;
  let heldCache: { at: number; works: Set<string> } | null = null;
  let seriesLikeCache: { at: number; rule: SeriesLike } | null = null;
  const alert = (subject: string, text: string) => {
    if (deps.now() < quietUntil) return;
    quietUntil = deps.now() + KEY_PAUSE_MS;
    deps.alert(subject, text);
  };
  const held = () => {
    if (!heldCache || deps.now() - heldCache.at >= HELD_CACHE_MS) heldCache = { at: deps.now(), works: heldCanonical(deps) };
    return heldCache.works;
  };
  const seriesLike = () => {
    if (!seriesLikeCache || deps.now() - seriesLikeCache.at >= SERIES_LIKE_CACHE_MS) seriesLikeCache = { at: deps.now(), rule: seriesLikeOriginals(deps.repo.originalTitleClaims()) };
    return seriesLikeCache.rule;
  };
  const classify: ClassifyMatch = async (input) => {
    try {
      return await deps.classify(input);
    } catch (error) {
      if (failureKind(error) === "budget" && deps.now() >= budgetLoggedUntil) {
        budgetLoggedUntil = nextUtcMidnight(deps.now());
        deps.info({ source: WORK_MATCH_SOURCE, until: new Date(budgetLoggedUntil).toISOString() }, "TypeSafe budget spent; translation matching waits for the next UTC day");
      }
      throw error;
    }
  };
  const judged = { ...deps, alert, classify };
  const queue = createWorkQueue({ concurrency: IN_FLIGHT, now: deps.now, run: (workId) => judgeWorkMatch(judged, workId, held, seriesLike), onError: deps.onError });
  const stopSweep = startDetailsBackfill(
    async () => {
      heldCache = { at: deps.now(), works: heldCanonical(deps) };
      for (const workId of deps.repo.portugueseWorksNeedingMatch([...heldCache.works], SWEEP_LIMIT, JEV_REJECTION_LIMIT, null)) queue.add(workId);
      return null;
    },
    (error) => deps.onError(error),
    SWEEP_INTERVAL_MS,
    undefined,
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

export function startTranslationJobsIfConfigured(apiKey: string, deps: Omit<Parameters<typeof startTranslationJobs>[0], "classify">): TranslationJobs | null {
  if (apiKey === "") return null;
  return startTranslationJobs({ ...deps, classify: createJevMatchClassifier(apiKey, dailySpend(deps.repo, WORK_MATCH_SOURCE, WORK_MATCH_DAILY_BUDGET, deps.now)) });
}
