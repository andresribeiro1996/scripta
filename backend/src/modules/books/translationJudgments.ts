import { createJevMatchClassifier, type ClassifyMatch } from "./adapters/typesafe/jevWorkMatch.js";
import { WorkMergeError } from "./domain/errors.js";
import type { BooksRepository } from "./domain/ports.js";
import { seriesNameKey } from "./domain/series.js";
import { joinVerdict, type JoinVerdict } from "./domain/volumeGuard.js";
import { authorPattern, evidenceOf, hasVolumeMarker, MATCH_MERGE_AT, MAX_CANDIDATES, mentionsSurname, sameMainTitle, sameWholeTitle, seriesLikeOriginals, surnameOf, titlePatterns, type SeriesLike, type TranslationEvidence } from "./domain/translation.js";
import { heldCanonical, JEV_REJECTION_LIMIT, JEV_SWEEP_LIMIT, jevPause, startJevJobs, type JevJobs, type JevJobsDeps, type JevPauseDeps } from "./jevJobs.js";
import { dailySpend } from "./typesafe.js";

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

const TRANSLATION_KEY_ALERT = { subject: "TypeSafe rejected the translation requests", text: "TypeSafe answered 401, so translation matching is paused for a day. Check TYPESAFE_API_KEY." };

export function arenaCheck(repo: Pick<BooksRepository, "canonicalWorkIds" | "aliasesOf">, worksShareAnArena: (aIds: string[], bIds: string[]) => boolean): (fromWorkId: string, intoWorkId: string) => boolean {
  const ids = (id: string) => {
    const live = repo.canonicalWorkIds([id]).get(id) ?? id;
    return [live, ...repo.aliasesOf([live])];
  };
  return (fromWorkId, intoWorkId) => worksShareAnArena(ids(fromWorkId), ids(intoWorkId));
}

export type TranslationDeps = JevPauseDeps & {
  repo: BooksRepository;
  classify: ClassifyMatch;
  sharesArena: (fromWorkId: string, intoWorkId: string) => boolean;
};

export function guardJoin(repo: Pick<BooksRepository, "translationEvidence" | "matchCandidates" | "seriesHasOtherMembers">, workId: string, intoWorkId: string): JoinVerdict {
  const rows = repo.translationEvidence(workId);
  const target = repo.matchCandidates([intoWorkId])[0];
  if (!rows || rows.editions.length === 0 || !target) return "join";
  const evidence = evidenceOf(rows);
  const headsSeries = (title: string) => {
    const key = seriesNameKey(title);
    return key !== null && repo.seriesHasOtherMembers(key, intoWorkId);
  };
  return joinVerdict({ title: evidence.title, originalTitle: evidence.originalTitle }, { title: target.title }, headsSeries);
}

function decide(deps: TranslationDeps, workId: string, model: string, intoWorkId: string | null, confidence: number | null, merge: boolean, at: string) {
  const verdict = merge && intoWorkId ? guardJoin(deps.repo, workId, intoWorkId) : "join";
  const saved = verdict === "never" ? null : intoWorkId;
  try {
    deps.repo.transaction(() => {
      deps.repo.saveWorkMatchJudgment(workId, { model, intoWorkId: saved, confidence, askedAt: at });
      deps.repo.clearJevRejection("works", workId);
      if (merge && intoWorkId && verdict === "join" && !deps.sharesArena(workId, intoWorkId)) deps.repo.mergeTranslation(workId, intoWorkId, model === "code" ? "code" : "jev", confidence, at);
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
    return jevPause(error, deps, TRANSLATION_KEY_ALERT, (strike) => deps.repo.recordJevRejection({ task: "works", subject: workId, ...strike, at: at() }));
  }
}

export const WORK_MATCH_SOURCE = "works";
export const WORK_MATCH_DAILY_BUDGET = 1000;
const SERIES_LIKE_CACHE_MS = 10 * 60 * 1000;

type HeldDeps = TranslationDeps & { heldWorkIds: () => string[] };
export type TranslationJobs = JevJobs;

export async function judgeWorkMatch(deps: HeldDeps, workId: string, held: () => Set<string> = () => heldCanonical(deps.repo, deps.heldWorkIds()), seriesLike: () => SeriesLike = () => seriesLikeOriginals(deps.repo.originalTitleClaims())): Promise<number | null> {
  const canonical = deps.repo.canonicalWorkIds([workId]).get(workId);
  if (!canonical || !held().has(canonical)) return null;
  if (deps.repo.portugueseWorksNeedingMatch([canonical], 1, JEV_REJECTION_LIMIT, null).length === 0) return null;
  deps.repo.fillOriginalTitlesFromSummaries(canonical);
  return matchWork(deps, canonical, seriesLike());
}

export function startTranslationJobs(deps: JevJobsDeps & { repo: BooksRepository; classify: ClassifyMatch; sharesArena: TranslationDeps["sharesArena"] }): TranslationJobs {
  let seriesLikeCache: { at: number; rule: SeriesLike } | null = null;
  const seriesLike = () => {
    if (!seriesLikeCache || deps.now() - seriesLikeCache.at >= SERIES_LIKE_CACHE_MS) seriesLikeCache = { at: deps.now(), rule: seriesLikeOriginals(deps.repo.originalTitleClaims()) };
    return seriesLikeCache.rule;
  };
  return startJevJobs(deps, {
    source: WORK_MATCH_SOURCE,
    budgetMessage: "TypeSafe budget spent; translation matching waits for the next UTC day",
    sweep: (held) => deps.repo.portugueseWorksNeedingMatch(held, JEV_SWEEP_LIMIT, JEV_REJECTION_LIMIT, null),
    judge: (workId, held, pause) => judgeWorkMatch({ ...deps, ...pause }, workId, held, seriesLike)
  });
}

export function startTranslationJobsIfConfigured(apiKey: string, deps: Omit<Parameters<typeof startTranslationJobs>[0], "classify">): TranslationJobs | null {
  if (apiKey === "") return null;
  return startTranslationJobs({ ...deps, classify: createJevMatchClassifier(apiKey, dailySpend(deps.repo, WORK_MATCH_SOURCE, WORK_MATCH_DAILY_BUDGET, deps.now)) });
}
