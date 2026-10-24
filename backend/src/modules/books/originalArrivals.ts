import { startDetailsBackfill } from "./backfill.js";
import { arrivalKey, evidenceOf, mentionsSurname, originalKey, originalWholeKey, sameWholeTitle, seriesLikeOriginals, sharedOriginals, surnameOf, type OriginalClaim } from "./domain/translation.js";
import { JEV_REJECTION_LIMIT } from "./jevJobs.js";
import { joinByCode } from "./translationBacklog.js";
import { planMatch, type TranslationDeps } from "./translationJudgments.js";

const ORIGINAL_ARRIVALS_BATCH = 500;
const ORIGINAL_ARRIVALS_INTERVAL_MS = 60 * 1000;
const ORIGINAL_ARRIVALS_TICK_MS = 200;

type ArrivalSteps = { arrivals: number; claimants: number; codeMerges: number; codeBlocked: number };
type ArrivalDeps = Pick<TranslationDeps, "repo" | "sharesArena" | "now">;

function joinClaimants(deps: ArrivalDeps, key: string, stem: string, surname: string, claims: OriginalClaim[], steps: ArrivalSteps) {
  const arrived = (original: string) => originalKey(original) === key || originalWholeKey(original) === key;
  const seriesLike = seriesLikeOriginals(claims);
  const shared = sharedOriginals(claims);
  const at = new Date(deps.now()).toISOString();
  const named = claims.flatMap((claim) => (claim.workId && arrived(claim.originalTitle) && mentionsSurname([claim.author], surname) ? [claim.workId] : []));
  const ids = [...new Set(deps.repo.canonicalWorkIds(named).values())];
  for (const workId of deps.repo.portugueseWorksNeedingMatch(ids, Number.MAX_SAFE_INTEGER, JEV_REJECTION_LIMIT, at)) {
    const rows = deps.repo.translationEvidence(workId);
    if (!rows) continue;
    const evidence = evidenceOf(rows);
    const original = evidence.originalTitle;
    const author = evidence.workAuthor || evidence.author;
    if (!original || originalKey(original) !== stem || !arrived(original) || shared(original, author)) continue;
    steps.claimants += 1;
    const plan = planMatch(deps.repo, workId, seriesLike);
    if (plan?.kind !== "code") continue;
    const target = deps.repo.getWorkView(plan.intoWorkId);
    if (!target?.olWorkKey || !target.editions.some((edition) => sameWholeTitle(edition.title, original))) continue;
    if (joinByCode(deps, workId, plan.intoWorkId, at)) steps.codeMerges += 1;
    else steps.codeBlocked += 1;
  }
}

function drainKey(deps: ArrivalDeps, titleKey: string): ArrivalSteps {
  const drained: ArrivalSteps = { arrivals: 1, claimants: 0, codeMerges: 0, codeBlocked: 0 };
  const key = arrivalKey(titleKey);
  const surname = surnameOf(titleKey.split("|")[1] ?? "");
  deps.repo.transaction(() => {
    if (key !== null && surname !== null) {
      for (const stem of new Set([key, ...deps.repo.originalKeysOf(key)])) {
        const claims = deps.repo.originalClaimsOf(stem);
        if (claims.length > 0) joinClaimants(deps, key, stem, surname, claims, drained);
      }
    }
    deps.repo.dropOriginalArrival(titleKey);
  });
  return drained;
}

export function joinArrivedOriginals(deps: ArrivalDeps, limit: number, onKeyError: (error: unknown, titleKey: string) => void): ArrivalSteps {
  const steps: ArrivalSteps = { arrivals: 0, claimants: 0, codeMerges: 0, codeBlocked: 0 };
  const start = deps.now();
  for (const titleKey of deps.repo.originalArrivals(limit)) {
    if (deps.now() - start >= ORIGINAL_ARRIVALS_TICK_MS) break;
    try {
      const drained = drainKey(deps, titleKey);
      for (const field of Object.keys(steps) as Array<keyof ArrivalSteps>) steps[field] += drained[field];
    } catch (error) {
      onKeyError(error, titleKey);
    }
  }
  return steps;
}

export function startOriginalArrivals(deps: ArrivalDeps & { info: (details: Record<string, unknown>, message: string) => void; onError: (error: unknown, titleKey?: string) => void }): () => void {
  return startDetailsBackfill(async () => {
    const steps = joinArrivedOriginals(deps, ORIGINAL_ARRIVALS_BATCH, deps.onError);
    if (steps.codeMerges + steps.codeBlocked > 0) deps.info({ ...steps }, "original arrivals joined");
    return null;
  }, deps.onError, ORIGINAL_ARRIVALS_INTERVAL_MS);
}
