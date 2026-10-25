import { searchTokens } from "./domain/normalize.js";
import { workIdsOf } from "./domain/workSearch.js";
import type { BooksRepository } from "./domain/ports.js";

export type Grade = { workId: string; grade: "named" | "related" | "unrelated"; confidence: number };
export type QueryScore = { q: string; hidden: boolean; ndcg: number; unlabelled: string[] };

const GRADE_GAIN = { named: 2, related: 1, unrelated: 0 };
const TOP = 10;
const POPULAR = 10;

export function gainOf(grade: Grade): number {
  return GRADE_GAIN[grade.grade] * grade.confidence;
}

export function ndcgAt(ranked: string[], gains: Map<string, number>, k: number): number {
  const dcg = (values: number[]) => values.slice(0, k).reduce((sum, gain, index) => sum + gain / Math.log2(index + 2), 0);
  const ideal = dcg([...gains.values()].sort((a, b) => b - a));
  if (ideal === 0) return 0;
  return dcg(ranked.map((workId) => gains.get(workId) ?? 0)) / ideal;
}

const mean = (values: number[]) => (values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length);

export function scoreQueries(queries: Array<{ q: string; hidden: boolean }>, ranked: Map<string, string[]>, grades: Map<string, Grade[]>): { perQuery: QueryScore[]; tune: number; hidden: number } {
  const perQuery = queries.map(({ q, hidden }) => {
    const order = ranked.get(q) ?? [];
    const graded = grades.get(q) ?? [];
    const gains = new Map(graded.map((grade) => [grade.workId, gainOf(grade)]));
    const known = new Set(graded.map(({ workId }) => workId));
    return { q, hidden, ndcg: ndcgAt(order, gains, TOP), unlabelled: order.slice(0, TOP).filter((workId) => !known.has(workId)) };
  });
  return {
    perQuery,
    tune: mean(perQuery.filter(({ hidden }) => !hidden).map(({ ndcg }) => ndcg)),
    hidden: mean(perQuery.filter(({ hidden }) => hidden).map(({ ndcg }) => ndcg))
  };
}

type CandidateRepo = Pick<BooksRepository, "searchBooks" | "canonicalWorkIds" | "searchSeries" | "matchCandidates">;

export function scorecardCandidates(repo: CandidateRepo, query: string, limit = 40): Array<{ workId: string; title: string; author: string; year: number | null }> {
  const tokens = searchTokens(query);
  const position = (value: string | null) => (value !== null && Number.isFinite(Number(value)) ? Number(value) : Infinity);
  const series = [...(repo.searchSeries(tokens).matches[0]?.members ?? [])].sort((a, b) => position(a.position) - position(b.position)).map(({ workId }) => workId);
  const rows = repo.searchBooks(tokens, 500);
  const canonical = repo.canonicalWorkIds(workIdsOf(rows));
  const fts = [...new Set(rows.flatMap((row) => (row.work_id ? [canonical.get(row.work_id) ?? row.work_id] : [])))];
  const details = new Map(repo.matchCandidates([...new Set([...series, ...fts])]).map((candidate) => [candidate.id, candidate]));
  const head = [...new Set(series)].slice(0, Math.max(0, limit - POPULAR));
  const taken = new Set(head);
  const popular = fts.filter((id) => !taken.has(id) && details.has(id)).sort((a, b) => details.get(b)!.editions - details.get(a)!.editions).slice(0, POPULAR);
  const kept = new Set([...taken, ...popular]);
  const middle = fts.filter((id) => !kept.has(id)).slice(0, Math.max(0, limit - kept.size));
  return [...head, ...middle, ...popular].slice(0, limit).flatMap((id) => {
    const found = details.get(id);
    return found ? [{ workId: id, title: found.title, author: found.author, year: found.year }] : [];
  });
}
