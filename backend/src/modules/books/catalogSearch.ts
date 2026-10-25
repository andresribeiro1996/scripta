import { SEARCH_LIMIT, WORK_SCAN_LIMIT, WORK_SEARCH_LIMIT } from "./domain/normalize.js";
import type { BooksRepository } from "./domain/ports.js";
import type { SeriesEntry } from "./domain/series.js";
import type { BookRow } from "./domain/types.js";
import { firstEditionPerWork, workIdsOf } from "./domain/workSearch.js";

export type Hit = { row: BookRow; workId: string | null; matched?: SeriesEntry };

export function canonicalHits(repo: BooksRepository, rows: BookRow[]): Hit[] {
  const canonical = repo.canonicalWorkIds(workIdsOf(rows));
  return rows.map((row) => ({ row, workId: row.work_id ? canonical.get(row.work_id) ?? row.work_id : null }));
}

function representativeEdition(repo: BooksRepository, workId: string): BookRow | undefined {
  const edition = repo.editionsOf([workId]).find(({ id }) => repo.isSearchable(id));
  return edition ? repo.getBook(edition.id) : undefined;
}

function seriesHits(repo: BooksRepository, tokens: string[], present: Hit[], room: number): Hit[] {
  const known = new Set(present.flatMap(({ workId }) => (workId ? [workId] : [])));
  const hits: Hit[] = [];
  for (const workId of repo.searchSeriesWorks(tokens, WORK_SCAN_LIMIT)) {
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
  const rows = repo.searchBooks(tokens, byWork ? WORK_SCAN_LIMIT : SEARCH_LIMIT);
  const hits = byWork ? firstEditionPerWork(rows, repo.canonicalWorkIds(workIdsOf(rows))).slice(0, cap) : canonicalHits(repo, rows);
  if (hits.length < cap) hits.push(...seriesHits(repo, tokens, hits, cap - hits.length));
  if (hits.length < cap) hits.push(...collectionHits(repo, tokens, hits, byWork, byWork ? WORK_SCAN_LIMIT : cap).slice(0, cap - hits.length));
  return hits;
}
