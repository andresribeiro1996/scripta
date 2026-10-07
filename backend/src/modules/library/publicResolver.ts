import type { DatabaseSync } from "node:sqlite";
import { isGroup, normalizeImageId, normalizeReaderCardStyle, publicReaderCard, publicStyle, readerIdentity, type Group, type IdentityKey, type PublicBookData, type PublicHighlight, type PublicLibraryData, type PublicReaderCard, type ReaderCardChosen, type ReaderCardStyle, type ShelfTheme } from "@scripta/shared";
import type { SharedBook } from "@scripta/shared/community";
import { peekCachedCoverUrl, peekCachedCoverUrls } from "../books/index.js";
import { openLibraryDb } from "./adapters/sqlite/connection.js";
import { canonicalWorkIds, copyKeysForWorks } from "./works.js";

export type { PublicBookData, PublicHighlight };

export interface PublicDataRequest {
  collectionIds?: string[];
  bookKeys: string[];
  highlightRefs: Array<{ bookKey: string; highlightId: string }>;
  needsCurrentlyReading: boolean;
  statsMetrics: string[];
  needsShelfTheme?: boolean;
  needsReaderCard?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface BookRowRecord {
  position: number;
  book_key: string;
  title: string | null;
  author: string | null;
  isbn: string | null;
  image_id: string | null;
  read_status: number | null;
  series_number: number | null;
  sort_order: number | null;
  cover_url: string | null;
  work_id: string | null;
}

interface SummaryRecord {
  meta: string | null;
  reader_card: string | null;
  shelf_theme: string | null;
  total_books: number;
  finished_count: number;
  in_progress_count: number;
  total_highlights: number;
}

function isbnOf(row: BookRowRecord): string | null {
  return row.book_key.startsWith("isbn:") ? row.book_key.slice(5) : null;
}

function coversOf(rows: BookRowRecord[]): Map<BookRowRecord, string | null> {
  const missing = rows.filter((row) => row.cover_url === null);
  const covers = peekCachedCoverUrls(missing.map((row) => ({ isbn: isbnOf(row), title: row.title, author: row.author })));
  return new Map(missing.map((row, i) => [row, covers[i]!]));
}

function toPublicBooks(rows: BookRowRecord[]): PublicBookData[] {
  const covers = coversOf(rows);
  const works = canonicalWorkIds(rows.flatMap((row) => (row.work_id ? [row.work_id] : [])));
  return rows.map((row) => ({
    title: row.title || "Untitled",
    author: row.author || "Unknown author",
    isbn: isbnOf(row),
    imageId: normalizeImageId(row.image_id) || null,
    coverUrl: row.cover_url ?? covers.get(row) ?? null,
    readStatus: row.read_status,
    key: row.book_key,
    workId: row.work_id && (works.get(row.work_id) ?? row.work_id)
  }));
}

function toPublicLibraryBooks(rows: BookRowRecord[]): Record<string, unknown>[] {
  const covers = coversOf(rows);
  return rows.map((row) => ({
    Title: row.title ?? undefined,
    Attribution: row.author ?? undefined,
    ISBN: row.isbn ?? undefined,
    ImageId: row.image_id ?? undefined,
    ReadStatus: row.read_status ?? undefined,
    SeriesNumber: row.series_number ?? undefined,
    _order: row.sort_order ?? undefined,
    _coverUrl: row.cover_url ?? covers.get(row) ?? null
  }));
}

const BOOK_COLUMNS = `SELECT position, book_key, title, author, isbn, image_id, read_status, series_number, sort_order, cover_url, work_id FROM library_books`;

type Statement = ReturnType<DatabaseSync["prepare"]>;
let cached: { summaryStmt: Statement; booksStmt: Statement; booksByKeyStmt: Statement; currentlyReadingStmt: Statement; highlightStmt: Statement; styleStmt: Statement; finishedInYearStmt: Statement; getGlyphStmt: Statement; sharedCountsStmt: Statement; sharedBooksStmt: Statement } | null = null;
function getStatements() {
  if (!cached) {
    const db = openLibraryDb();
    cached = {
      summaryStmt: db.prepare(`SELECT meta, reader_card, shelf_theme, total_books, finished_count, in_progress_count, total_highlights FROM library_summary WHERE user_id = ?`),
      booksStmt: db.prepare(`${BOOK_COLUMNS} WHERE user_id = ? ORDER BY position`),
      booksByKeyStmt: db.prepare(`${BOOK_COLUMNS} WHERE user_id = ? AND book_key IN (SELECT value FROM json_each(?)) ORDER BY position`),
      currentlyReadingStmt: db.prepare(`${BOOK_COLUMNS} WHERE user_id = ? AND read_status = 1 ORDER BY position`),
      highlightStmt: db.prepare(`SELECT text, annotation FROM library_highlights WHERE user_id = ? AND position = ? AND highlight_id = ?`),
      styleStmt: db.prepare(`SELECT style FROM reader_card_styles WHERE user_id = ?`),
      finishedInYearStmt: db.prepare(`SELECT COUNT(*) AS n FROM library_books WHERE user_id = ? AND finished_year = ?`),
      getGlyphStmt: db.prepare(`SELECT glyph FROM library_derived WHERE user_id = ?`),
      sharedCountsStmt: db.prepare(`
        SELECT o.user_id AS user_id, COUNT(DISTINCT m.book_ref) AS shared
        FROM library_match_keys m
        JOIN library_match_keys o ON o.key = m.key
        WHERE m.user_id = ? AND +o.user_id IN (SELECT value FROM json_each(?))
        GROUP BY o.user_id
      `),
      sharedBooksStmt: db.prepare(`
        SELECT DISTINCT m.book_ref, m.title, m.author, m.isbn, m.cover
        FROM library_match_keys m
        WHERE m.user_id = ? AND m.key IN (SELECT o.key FROM library_match_keys o WHERE o.user_id = ?)
        ORDER BY m.book_ref
        LIMIT ?
      `)
    };
  }
  return cached;
}

const EMPTY_RESULT: PublicLibraryData = { books: [], highlights: [], currentlyReading: [], stats: {} };

function emptyResult(req: PublicDataRequest): PublicLibraryData {
  return req.needsReaderCard ? { ...EMPTY_RESULT, readerCard: publicReaderCard(readerIdentity([], [])) } : EMPTY_RESULT;
}

interface ParsedLibraryDocument {
  allBooks: Record<string, unknown>[];
  groupRecords: Record<string, unknown>[];
}

export function libraryParts(parsed: unknown): ParsedLibraryDocument | null {
  if (!isRecord(parsed) || !Array.isArray(parsed.books)) return null;
  return {
    allBooks: parsed.books.filter(isRecord),
    groupRecords: Array.isArray(parsed.groups) ? parsed.groups.filter(isRecord) : []
  };
}

// Tolerant filtering, same convention as this file's byKey/collection
// lookups: a malformed group (missing bookKeys, non-string name) is
// dropped rather than crashing readerIdentity's own iteration over it.
export function toReaderGroups(groupRecords: unknown[]): Group[] {
  return groupRecords.filter(isGroup);
}

export function readerGlyphFor(userId: string): IdentityKey | null {
  const row = getStatements().getGlyphStmt.get(userId) as { glyph: IdentityKey | null } | undefined;
  return row?.glyph ?? null;
}

export function sharedBookCounts(viewerId: string, candidateIds: string[]): Map<string, number> {
  const rows = getStatements().sharedCountsStmt.all(viewerId, JSON.stringify(candidateIds)) as Array<{ user_id: string; shared: number }>;
  return new Map(rows.map((row) => [row.user_id, row.shared]));
}

export function sharedBooks(viewerId: string, candidateId: string, limit: number): SharedBook[] {
  const rows = getStatements().sharedBooksStmt.all(viewerId, candidateId, limit) as Array<{ title: string; author: string; isbn: string | null; cover: string | null }>;
  return rows.map((row) => ({ title: row.title, author: row.author, coverUrl: row.cover ?? peekCachedCoverUrl({ isbn: row.isbn, title: row.title, author: row.author }) }));
}

function readSummary(userId: string): SummaryRecord | undefined {
  return getStatements().summaryStmt.get(userId) as SummaryRecord | undefined;
}

function readerCardStyleOf(userId: string): ReaderCardStyle {
  const row = getStatements().styleStmt.get(userId) as { style: string } | undefined;
  return normalizeReaderCardStyle(row ? JSON.parse(row.style) : null);
}

function chosenOf(userId: string, style: ReaderCardStyle, byKey: Map<string, BookRowRecord>): ReaderCardChosen {
  const chosen: ReaderCardChosen = {};
  const signatureRow = style.signature ? byKey.get(style.signature.bookKey) : undefined;
  if (style.signature && signatureRow) {
    const [book] = toPublicBooks([signatureRow]);
    chosen.signature = { title: book!.title, author: book!.author, workId: book!.workId ?? null, coverUrl: book!.coverUrl, note: style.signature.note };
  }
  const highlightRow = style.highlight ? byKey.get(style.highlight.bookKey) : undefined;
  if (style.highlight && highlightRow) {
    const found = getStatements().highlightStmt.get(userId, highlightRow.position, style.highlight.highlightId) as { text: string | null } | undefined;
    if (found?.text?.trim()) chosen.highlight = { text: found.text, title: highlightRow.title || "Untitled", author: highlightRow.author || "Unknown author" };
  }
  return chosen;
}

export function resolvePublicLibraryData(userId: string, req: PublicDataRequest): PublicLibraryData {
  const summary = readSummary(userId);
  if (!summary || summary.meta === null) return emptyResult(req);
  const statements = getStatements();
  const meta = JSON.parse(summary.meta) as { groups?: unknown };
  const groupRecords = Array.isArray(meta.groups) ? meta.groups.filter(isRecord) : [];

  const collectionCandidates: Record<string, string[]> = Object.create(null);
  for (const id of req.collectionIds ?? []) {
    const collection = groupRecords.find((group) => group.id === id && group.type === "collection");
    collectionCandidates[id] = Array.isArray(collection?.bookKeys) ? collection.bookKeys.filter((key): key is string => typeof key === "string") : [];
  }
  const style = req.needsReaderCard ? readerCardStyleOf(userId) : null;
  const choiceKeys = [style?.signature?.bookKey, style?.highlight?.bookKey].filter((key): key is string => Boolean(key));
  const wantedKeys = [...new Set([...req.bookKeys, ...Object.values(collectionCandidates).flat(), ...req.highlightRefs.map((ref) => ref.bookKey), ...choiceKeys])];
  const byKey = new Map<string, BookRowRecord>();
  if (wantedKeys.length > 0) {
    for (const row of statements.booksByKeyStmt.all(userId, JSON.stringify(wantedKeys)) as unknown as BookRowRecord[]) byKey.set(row.book_key, row);
  }

  const collectionBooks: Record<string, string[]> = Object.create(null);
  for (const [id, keys] of Object.entries(collectionCandidates)) collectionBooks[id] = keys.filter((key) => byKey.has(key));
  const referenced: BookRowRecord[] = [];
  for (const key of new Set([...req.bookKeys, ...Object.values(collectionBooks).flat()])) {
    const row = byKey.get(key);
    if (row) referenced.push(row);
  }

  const highlights: PublicHighlight[] = [];
  for (const ref of req.highlightRefs) {
    const book = byKey.get(ref.bookKey);
    if (!book) continue;
    const highlight = statements.highlightStmt.get(userId, book.position, ref.highlightId) as { text: string | null; annotation: string | null } | undefined;
    if (!highlight) continue;
    highlights.push({ bookKey: ref.bookKey, highlightId: ref.highlightId, text: highlight.text ?? "", annotation: highlight.annotation || null });
  }

  const currentlyReading = req.needsCurrentlyReading ? toPublicBooks(statements.currentlyReadingStmt.all(userId) as unknown as BookRowRecord[]) : [];

  const stats: Record<string, number> = {};
  for (const metric of req.statsMetrics) {
    switch (metric) {
      case "totalBooks":
        stats[metric] = summary.total_books;
        break;
      case "booksFinished":
        stats[metric] = summary.finished_count;
        break;
      case "booksFinishedThisYear":
        stats[metric] = (statements.finishedInYearStmt.get(userId, new Date().getFullYear()) as { n: number }).n;
        break;
      case "booksInProgress":
        stats[metric] = summary.in_progress_count;
        break;
      case "totalHighlights":
        stats[metric] = summary.total_highlights;
        break;
    }
  }

  if (req.needsReaderCard && summary.reader_card === null) throw new Error(`Reader card of ${userId} is unavailable.`);
  if (req.needsShelfTheme && summary.shelf_theme === null) throw new Error(`Shelf theme of ${userId} is unavailable.`);
  return {
    books: toPublicBooks(referenced),
    highlights,
    currentlyReading,
    stats,
    ...(req.needsShelfTheme ? { shelfTheme: JSON.parse(summary.shelf_theme as string) as ShelfTheme } : {}),
    ...(req.needsReaderCard ? { readerCard: { ...(JSON.parse(summary.reader_card as string) as PublicReaderCard), style: publicStyle(style!), chosen: chosenOf(userId, style!, byKey) } } : {}),
    ...(req.collectionIds ? { collectionBooks } : {})
  };
}

export function resolvePublicLibrary(userId: string): Record<string, unknown> | null {
  const summary = readSummary(userId);
  if (!summary || summary.meta === null) return null;
  const rows = getStatements().booksStmt.all(userId) as unknown as BookRowRecord[];
  return { ...(JSON.parse(summary.meta) as Record<string, unknown>), books: toPublicLibraryBooks(rows) };
}

export function resolvePublicBooksByWork(ownerUserId: string, workIds: string[]): Map<string, PublicBookData> {
  const canonical = canonicalWorkIds(workIds);
  const keys = copyKeysForWorks(ownerUserId, [...new Set(canonical.values())]);
  const books = resolvePublicLibraryData(ownerUserId, { bookKeys: [...new Set(keys.values())], highlightRefs: [], needsCurrentlyReading: false, statsMetrics: [] }).books;
  const byKey = new Map(books.map((book) => [book.key, book]));
  const result = new Map<string, PublicBookData>();
  for (const id of workIds) {
    const key = keys.get(canonical.get(id) ?? "");
    const book = key === undefined ? undefined : byKey.get(key);
    if (book) result.set(id, book);
  }
  return result;
}
