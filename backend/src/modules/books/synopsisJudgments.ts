import { createJevSynopsisClassifier, type ClassifySynopsis } from "./adapters/typesafe/jevSynopsis.js";
import type { BooksRepository } from "./domain/ports.js";
import { isFragment } from "./domain/synopsis.js";
import { heldCanonical, JEV_REJECTION_LIMIT, JEV_SWEEP_LIMIT, jevPause, startJevJobs, type JevJobs, type JevJobsDeps, type JevPauseDeps } from "./jevJobs.js";
import { dailySpend } from "./typesafe.js";

export const SYNOPSIS_SOURCE = "synopses";
export const SYNOPSIS_DAILY_BUDGET = 1000;
const WORK_TEXT_LIMIT = 50;

const SYNOPSIS_KEY_ALERT = { subject: "TypeSafe rejected the synopsis requests", text: "TypeSafe answered 401, so synopsis checks are paused for a day. Check TYPESAFE_API_KEY." };

export type SynopsisJudgmentDeps = JevPauseDeps & { repo: BooksRepository; classify: ClassifySynopsis };
type HeldDeps = SynopsisJudgmentDeps & { heldWorkIds: () => string[] };
export type SynopsisJobs = JevJobs;

export function applySynopsisRule(repo: Pick<BooksRepository, "synopsisText" | "saveSynopsisJudgment">, hash: string, at: string): boolean {
  const carrier = repo.synopsisText(hash);
  if (!carrier || !isFragment(carrier.text)) return false;
  repo.saveSynopsisJudgment(hash, { model: "rule", usable: 0, kind: "fragment", askedAt: at });
  return true;
}

export async function classifyText(deps: SynopsisJudgmentDeps, hash: string): Promise<number | null> {
  const at = () => new Date(deps.now()).toISOString();
  if (applySynopsisRule(deps.repo, hash, at())) return null;
  const carrier = deps.repo.synopsisText(hash);
  if (!carrier) return null;
  try {
    const answer = await deps.classify(carrier);
    deps.repo.transaction(() => {
      deps.repo.saveSynopsisJudgment(hash, { model: answer.model, usable: answer.usable, kind: answer.kind, askedAt: at() });
      deps.repo.clearJevRejection("synopses", hash);
    });
    return null;
  } catch (error) {
    return jevPause(error, deps, SYNOPSIS_KEY_ALERT, (strike) => deps.repo.recordJevRejection({ task: "synopses", subject: hash, ...strike, at: at() }));
  }
}

export async function judgeWorkSynopses(deps: HeldDeps, workId: string, held: () => Set<string> = () => heldCanonical(deps.repo, deps.heldWorkIds())): Promise<number | null> {
  const canonical = deps.repo.canonicalWorkIds([workId]).get(workId);
  if (!canonical || !held().has(canonical)) return null;
  for (const hash of deps.repo.synopsesNeedingJudgment([canonical], WORK_TEXT_LIMIT, JEV_REJECTION_LIMIT)) {
    const pause = await classifyText(deps, hash);
    if (pause !== null) return pause;
  }
  return null;
}

export function startSynopsisJobs(deps: JevJobsDeps & { repo: BooksRepository; classify: ClassifySynopsis }): SynopsisJobs {
  return startJevJobs(deps, {
    source: SYNOPSIS_SOURCE,
    budgetMessage: "TypeSafe budget spent; synopsis checks wait for the next UTC day",
    sweep: (held) => deps.repo.worksNeedingSynopsisJudgment(held, JEV_SWEEP_LIMIT, JEV_REJECTION_LIMIT),
    judge: (workId, held, pause) => judgeWorkSynopses({ ...deps, ...pause }, workId, held)
  });
}

export function startSynopsisJobsIfConfigured(apiKey: string, deps: Omit<Parameters<typeof startSynopsisJobs>[0], "classify">): SynopsisJobs | null {
  if (apiKey === "") return null;
  return startSynopsisJobs({ ...deps, classify: createJevSynopsisClassifier(apiKey, dailySpend(deps.repo, SYNOPSIS_SOURCE, SYNOPSIS_DAILY_BUDGET, deps.now)) });
}
