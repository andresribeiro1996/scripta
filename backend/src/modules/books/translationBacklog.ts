import type { ClassifyMatch } from "./adapters/typesafe/jevWorkMatch.js";
import type { BooksRepository } from "./domain/ports.js";
import { MATCH_MERGE_AT, MATCH_REVIEW_AT, seriesLikeOriginals } from "./domain/translation.js";
import { JEV_REJECTION_LIMIT } from "./synopsisJudgments.js";
import { matchWork, planMatch, type TranslationDeps } from "./translationJudgments.js";
import { failureKind, type FailureKind } from "./typesafe.js";

export const TRANSLATION_BACKLOG_SOURCE = "works-backlog";
export const RECHECK_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const IN_FLIGHT = 4;
const COST_PER_REQUEST_USD = 0.00012;

export type TranslationBacklogStop = "done" | "budget" | "outage" | "key";
export type CodeSteps = { originals: number; noCandidates: number; codeMerges: number; codeBlocked: number; ask: string[] };

export function translationBacklogWorks(repo: Pick<BooksRepository, "canonicalWorkIds" | "portugueseWorksNeedingMatch">, heldWorkIds: string[], recheckBefore: string | null): string[] {
  const held = new Set(repo.canonicalWorkIds(heldWorkIds).values());
  const works = repo.portugueseWorksNeedingMatch(null, Number.MAX_SAFE_INTEGER, JEV_REJECTION_LIMIT, recheckBefore);
  return [...works.filter((id) => held.has(id)), ...works.filter((id) => !held.has(id))];
}

export function translationDryRun(repo: Pick<BooksRepository, "translationEvidence" | "originalTitleClaims" | "titleCandidates" | "authorCandidates" | "matchCandidates">, workIds: string[], max: number) {
  const counts = { selected: workIds.length, originalTitles: 0, originals: 0, noCandidates: 0, codeMerges: 0, wouldAsk: 0, seriesLike: 0, max };
  const seriesLike = seriesLikeOriginals(repo.originalTitleClaims());
  for (const workId of workIds) {
    const rows = repo.translationEvidence(workId);
    if (rows?.editions.some((edition) => !edition.originalTitle && /t[íi]tulo original/i.test(edition.summary ?? ""))) counts.originalTitles += 1;
    let blocked = false;
    const plan = planMatch(repo, workId, (original, author) => {
      blocked = seriesLike(original, author);
      return blocked;
    });
    if (blocked) counts.seriesLike += 1;
    if (plan?.kind === "original") counts.originals += 1;
    else if (plan?.kind === "none") counts.noCandidates += 1;
    else if (plan?.kind === "code") counts.codeMerges += 1;
    else if (plan?.kind === "ask") counts.wouldAsk += 1;
  }
  counts.wouldAsk = Math.min(counts.wouldAsk, max);
  return counts;
}

export function joinByCode(deps: Pick<TranslationDeps, "repo" | "sharesArena">, workId: string, intoWorkId: string, at: string): boolean {
  const blocked = deps.sharesArena(workId, intoWorkId);
  deps.repo.transaction(() => {
    deps.repo.saveWorkMatchJudgment(workId, { model: "code", intoWorkId, confidence: null, askedAt: at });
    if (!blocked) deps.repo.mergeTranslation(workId, intoWorkId, "code", null, at);
  });
  return !blocked;
}

export function runCodeSteps(deps: TranslationDeps, workIds: string[]): CodeSteps {
  const steps: CodeSteps = { originals: 0, noCandidates: 0, codeMerges: 0, codeBlocked: 0, ask: [] };
  const at = new Date(deps.now()).toISOString();
  deps.repo.fillOriginalTitlesFromSummaries();
  const seriesLike = seriesLikeOriginals(deps.repo.originalTitleClaims());
  for (const workId of workIds) {
    const plan = planMatch(deps.repo, workId, seriesLike);
    if (!plan) continue;
    if (plan.kind === "ask") {
      steps.ask.push(workId);
      continue;
    }
    if (plan.kind === "code") {
      if (joinByCode(deps, workId, plan.intoWorkId, at)) steps.codeMerges += 1;
      else steps.codeBlocked += 1;
      continue;
    }
    deps.repo.saveWorkMatchJudgment(workId, { model: "code", intoWorkId: null, confidence: null, askedAt: at });
    if (plan.kind === "original") steps.originals += 1;
    else steps.noCandidates += 1;
  }
  return steps;
}

export async function runTranslationBacklog(deps: TranslationDeps, workIds: string[]): Promise<{ asked: string[]; stoppedBy: TranslationBacklogStop }> {
  const asked: string[] = [];
  const seriesLike = seriesLikeOriginals(deps.repo.originalTitleClaims());
  let stoppedBy: TranslationBacklogStop = "done";
  let next = 0;
  const worker = async () => {
    while (stoppedBy === "done" && next < workIds.length) {
      const workId = workIds[next++]!;
      const call: { failure: FailureKind | null } = { failure: null };
      const classify: ClassifyMatch = async (input) => {
        try {
          return await deps.classify(input);
        } catch (error) {
          call.failure = failureKind(error);
          throw error;
        }
      };
      const pause = await matchWork({ ...deps, classify }, workId, seriesLike);
      if (pause === null) asked.push(workId);
      else if (stoppedBy === "done") stoppedBy = call.failure === "budget" || call.failure === "key" ? call.failure : "outage";
    }
  };
  await Promise.all(Array.from({ length: IN_FLIGHT }, worker));
  return { asked, stoppedBy };
}

export function translationBacklogReport(
  repo: Pick<BooksRepository, "workMatchJudgments" | "jevRejections" | "canonicalWorkIds">,
  input: { steps: CodeSteps; asked: string[]; stoppedBy: TranslationBacklogStop | "no-key"; requests: number; originalTitles: number }
) {
  const judgments = repo.workMatchJudgments(input.asked);
  const merged = repo.canonicalWorkIds(input.asked);
  const counts = { jevMerges: 0, jevBlocked: 0, possible: 0, none: 0 };
  for (const workId of input.asked) {
    const judgment = judgments.get(workId);
    if (!judgment) continue;
    if (judgment.intoWorkId === null || (judgment.confidence ?? 0) < MATCH_REVIEW_AT) counts.none += 1;
    else if ((judgment.confidence ?? 0) < MATCH_MERGE_AT) counts.possible += 1;
    else if (merged.get(workId) !== workId) counts.jevMerges += 1;
    else counts.jevBlocked += 1;
  }
  return {
    originalTitles: input.originalTitles,
    originals: input.steps.originals,
    noCandidates: input.steps.noCandidates,
    codeMerges: input.steps.codeMerges,
    codeBlocked: input.steps.codeBlocked,
    ...counts,
    strikes: repo.jevRejections("works", input.asked).size,
    stoppedBy: input.stoppedBy,
    requests: input.requests,
    estimatedCostUsd: Number((input.requests * COST_PER_REQUEST_USD).toFixed(2))
  };
}
