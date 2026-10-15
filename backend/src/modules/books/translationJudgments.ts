import type { ClassifyMatch } from "./adapters/typesafe/jevWorkMatch.js";
import { WorkMergeError } from "./domain/errors.js";
import type { BooksRepository } from "./domain/ports.js";
import { authorPattern, evidenceOf, MATCH_MERGE_AT, MAX_CANDIDATES, mentionsSurname, sameMainTitle, surnameOf, titlePattern, type TranslationEvidence } from "./domain/translation.js";
import { failureKind, nextUtcMidnight, strikeReason } from "./typesafe.js";

export type MatchCandidate = { id: string; title: string; author: string; year: number | null };
export type MatchPlan = { kind: "original" } | { kind: "none" } | { kind: "code"; intoWorkId: string } | { kind: "ask"; evidence: TranslationEvidence; candidates: MatchCandidate[] };

type PlanRepo = Pick<BooksRepository, "translationEvidence" | "titleCandidates" | "authorCandidates" | "matchCandidates">;

export function planMatch(repo: PlanRepo, workId: string): MatchPlan | null {
  const rows = repo.translationEvidence(workId);
  if (!rows || rows.editions.length === 0) return null;
  const evidence = evidenceOf(rows);
  if (evidence.originalTitle && sameMainTitle(evidence.originalTitle, evidence.title)) return { kind: "original" };
  const byTitlePattern = evidence.originalTitle ? titlePattern(evidence.originalTitle) : null;
  const byTitle = byTitlePattern ? repo.titleCandidates(byTitlePattern).filter((id) => id !== workId) : [];
  const byAuthorPattern = authorPattern(evidence.workAuthor || evidence.author);
  const byAuthor = byAuthorPattern ? repo.authorCandidates(byAuthorPattern).filter((id) => id !== workId && !byTitle.includes(id)) : [];
  if (byTitle.length === 0 && byAuthor.length === 0) return { kind: "none" };
  if (byTitle.length === 1) {
    const [only] = repo.matchCandidates(byTitle);
    const surname = only ? surnameOf(only.author) : null;
    if (only && surname && mentionsSurname([evidence.workAuthor, evidence.author, ...evidence.summaries], surname)) return { kind: "code", intoWorkId: only.id };
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

export async function matchWork(deps: TranslationDeps, workId: string): Promise<number | null> {
  const at = () => new Date(deps.now()).toISOString();
  const plan = planMatch(deps.repo, workId);
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
