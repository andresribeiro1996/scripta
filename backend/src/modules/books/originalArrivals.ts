import { normalizeTitle, normalizeWords } from "@scripta/shared";
import { startDetailsBackfill } from "./backfill.js";
import { arrivalKey, evidenceOf, isPortuguese, mainTitle, mentionsSurname, originalKey, sameMainTitle, seriesLikeOriginals, surnameOf, type OriginalClaim, type SeriesLike } from "./domain/translation.js";
import { sameWholeTitle } from "./seed/originalsFill.js";
import { JEV_REJECTION_LIMIT } from "./synopsisJudgments.js";
import { joinByCode } from "./translationBacklog.js";
import { planMatch, type TranslationDeps } from "./translationJudgments.js";

const ORIGINAL_ARRIVALS_BATCH = 500;
const ORIGINAL_ARRIVALS_INTERVAL_MS = 60 * 1000;
const ORIGINAL_ARRIVALS_TICK_MS = 200;

type ArrivalSteps = { arrivals: number; claimants: number; codeMerges: number; codeBlocked: number };
type ArrivalDeps = Pick<TranslationDeps, "repo" | "sharesArena" | "now">;

const bucketOf = (original: string, author: string) => `${original}#${surnameOf(author) ?? ""}`;

export function sharedOriginals(claims: OriginalClaim[]): SeriesLike {
  const buckets = new Map<string, { titles: Set<string>; originals: Set<string> }>();
  for (const claim of claims) {
    const original = originalKey(claim.originalTitle);
    const title = normalizeWords(claim.title);
    if (!isPortuguese(claim.language) || original === null || title === "" || sameMainTitle(claim.title, claim.originalTitle)) continue;
    const key = bucketOf(original, claim.author);
    const bucket = buckets.get(key) ?? { titles: new Set(), originals: new Set() };
    bucket.titles.add(title);
    bucket.originals.add(normalizeWords(claim.originalTitle));
    buckets.set(key, bucket);
  }
  return (originalTitle, author) => {
    const original = originalKey(originalTitle);
    const bucket = original === null ? undefined : buckets.get(bucketOf(original, author));
    return bucket !== undefined && (bucket.titles.size >= 2 || bucket.originals.size >= 2);
  };
}

function joinClaimants(deps: ArrivalDeps, key: string, surname: string, claims: OriginalClaim[], steps: ArrivalSteps) {
  const seriesLike = seriesLikeOriginals(claims);
  const shared = sharedOriginals(claims);
  const at = new Date(deps.now()).toISOString();
  const named = claims.flatMap((claim) => (claim.workId && mentionsSurname([claim.author], surname) ? [claim.workId] : []));
  const ids = [...new Set(deps.repo.canonicalWorkIds(named).values())];
  for (const workId of deps.repo.portugueseWorksNeedingMatch(ids, Number.MAX_SAFE_INTEGER, JEV_REJECTION_LIMIT, at)) {
    const rows = deps.repo.translationEvidence(workId);
    if (!rows) continue;
    const evidence = evidenceOf(rows);
    const original = evidence.originalTitle;
    const author = evidence.workAuthor || evidence.author;
    if (!original || originalKey(original) !== key || normalizeWords(original) !== normalizeTitle(mainTitle(original)) || shared(original, author)) continue;
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
      const claims = deps.repo.originalClaimsOf(key);
      if (claims.length > 0) joinClaimants(deps, key, surname, claims, drained);
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
