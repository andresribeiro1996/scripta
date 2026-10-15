import type { BooksRepository } from "./domain/ports.js";
import { authorPattern, evidenceOf, MAX_CANDIDATES, mentionsSurname, sameMainTitle, surnameOf, titlePattern, type TranslationEvidence } from "./domain/translation.js";

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
