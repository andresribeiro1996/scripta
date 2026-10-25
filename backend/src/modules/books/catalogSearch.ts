import { CATALOG_SCAN_LIMIT, normalizeWords, SEARCH_LIMIT, WORK_SCAN_LIMIT, WORK_SEARCH_LIMIT } from "./domain/normalize.js";
import type { BooksRepository, SeriesMatch } from "./domain/ports.js";
import { rankWorks, seriesOrder, withoutArticle, type RankCandidate } from "./domain/searchRank.js";
import type { SeriesEntry } from "./domain/series.js";
import type { BookRow } from "./domain/types.js";
import { coveredFirst, firstEditionPerWork, workIdsOf } from "./domain/workSearch.js";

export type Hit = { row: BookRow; workId: string | null; matched?: SeriesEntry };

const NO_SIGNALS = { editions: 0, languages: 0, hasCover: false, wikipediaSites: null };

function withWorkIds(rows: BookRow[], canonical: Map<string, string>): Hit[] {
  return rows.map((row) => ({ row, workId: row.work_id ? canonical.get(row.work_id) ?? row.work_id : null }));
}

export function canonicalHits(repo: BooksRepository, rows: BookRow[]): Hit[] {
  return withWorkIds(rows, repo.canonicalWorkIds(workIdsOf(rows)));
}

function byWorkKey(hits: Hit[]): Map<string, Hit[]> {
  const groups = new Map<string, Hit[]>();
  for (const hit of hits) {
    const key = hit.workId ?? hit.row.id;
    const group = groups.get(key) ?? [];
    group.push(hit);
    groups.set(key, group);
  }
  return groups;
}

function rankedWorkKeys(repo: BooksRepository, tokens: string[], rows: Array<BookRow & { search_score: number }>, groups: Map<string, Hit[]>, matches: SeriesMatch[]): string[] {
  const query = withoutArticle(tokens.join(" "));
  const textScore = new Map(rows.map((row) => [row.id, -row.search_score]));
  const signals = repo.workSignals([...groups].flatMap(([key, [first]]) => (first?.workId ? [key] : [])));
  const candidates: RankCandidate[] = [...groups].map(([key, hits]) => ({
    workId: key,
    textScore: Math.max(...hits.map(({ row }) => textScore.get(row.id)!)),
    exactTitle: hits.some(({ row }) => withoutArticle(normalizeWords(row.title)) === query),
    signals: signals.get(key) ?? NO_SIGNALS
  }));
  const [series] = matches;
  const leading = series && (series.exact || !candidates.some(({ exactTitle }) => exactTitle)) ? seriesOrder(series.members) : [];
  const led = new Set(leading);
  return [...leading, ...rankWorks(candidates.filter(({ workId }) => !led.has(workId)))];
}

function representativeEdition(repo: BooksRepository, workId: string): BookRow | undefined {
  const ordered = coveredFirst(repo.editionsOf([workId]), ({ workId: id }) => id, ({ hasCover }) => hasCover, ({ title }) => title);
  const edition = ordered.find(({ id }) => repo.isSearchable(id));
  return edition ? repo.getBook(edition.id) : undefined;
}

function seriesHits(repo: BooksRepository, workIds: string[], known: Set<string>, room: number): Hit[] {
  const hits: Hit[] = [];
  for (const workId of workIds) {
    if (hits.length === room) break;
    const row = known.has(workId) ? undefined : representativeEdition(repo, workId);
    if (row) hits.push({ row, workId });
  }
  return hits;
}

function collectionHits(repo: BooksRepository, tokens: string[], present: Hit[], byWork: boolean, limit: number): Hit[] {
  const books = new Set(present.map(({ row }) => row.id));
  const works = new Set(present.flatMap(({ workId }) => (workId ? [workId] : [])));
  const matches = repo.searchCollectionBooks(tokens, limit).filter(({ bookId }) => !books.has(bookId));
  const rows = matches.flatMap(({ bookId }) => {
    const row = repo.getBook(bookId);
    return row ? [row] : [];
  });
  const entries = new Map(matches.map(({ bookId, name, position }) => [bookId, { name, position }]));
  return canonicalHits(repo, rows).flatMap((hit) => {
    if (byWork && hit.workId !== null) {
      if (works.has(hit.workId)) return [];
      works.add(hit.workId);
    }
    return [{ ...hit, matched: entries.get(hit.row.id) }];
  });
}

export function catalogHits(repo: BooksRepository, tokens: string[], byWork: boolean): Hit[] {
  const cap = byWork ? WORK_SEARCH_LIMIT : SEARCH_LIMIT;
  const rows = repo.searchBooks(tokens, CATALOG_SCAN_LIMIT);
  const canonical = repo.canonicalWorkIds(workIdsOf(rows));
  const editions = byWorkKey(withWorkIds(rows, canonical));
  const shown = byWork ? byWorkKey(firstEditionPerWork(rows, canonical)) : editions;
  const { workIds, matches } = repo.searchSeries(tokens);
  const hits: Hit[] = [];
  const tried = new Set<string>();
  for (const key of rankedWorkKeys(repo, tokens, rows, editions, matches)) {
    if (hits.length >= cap) break;
    tried.add(key);
    const found = shown.get(key);
    const row = found ? undefined : representativeEdition(repo, key);
    hits.push(...(found ?? (row ? [{ row, workId: key }] : [])));
  }
  hits.splice(cap);
  if (hits.length < cap) hits.push(...seriesHits(repo, workIds, tried, cap - hits.length));
  if (hits.length >= cap) return hits;
  const collected = collectionHits(repo, tokens, hits, byWork, byWork ? WORK_SCAN_LIMIT : cap).slice(0, cap - hits.length);
  if (byWork) return [...hits, ...collected];
  const grouped = [...hits];
  const tail: Hit[] = [];
  for (const hit of collected) {
    const last = hit.workId === null ? -1 : grouped.map(({ workId }) => workId).lastIndexOf(hit.workId);
    if (last !== -1) grouped.splice(last + 1, 0, hit);
    else {
      const inTail = hit.workId === null ? -1 : tail.map(({ workId }) => workId).lastIndexOf(hit.workId);
      tail.splice(inTail === -1 ? tail.length : inTail + 1, 0, hit);
    }
  }
  return [...grouped, ...tail];
}
