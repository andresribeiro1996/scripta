import type { BookMetadata, BookSearchResult, CatalogBookMetadata } from "@scripta/shared";
import type { BookRow, CoverImageRow, CoverSourceName, CoverStatus, DataSource, NewBook, SummarySource, WorkPageRows, WorkView } from "./types.js";

export type MergeableDetails = Pick<BookMetadata, "summary" | "pages" | "year" | "publisher" | "translator">;

export interface CoverBlobStore {
  save(id: string, extension: string, bytes: Buffer): Promise<void>;
}

export interface PageCursor { at: string; row: number }
export interface IdPage { ids: string[]; next: PageCursor | null }

export interface BooksRepository {
  transaction<T>(write: () => T): T;
  findBookByKey(key: string): BookRow | undefined;
  findBooksByKeys(keys: string[]): Map<string, BookRow>;
  getBook(id: string): BookRow | undefined;
  createBook(input: NewBook, keys: string[], createdAt: string): BookRow;
  addKey(key: string, bookId: string): void;
  fillIdentity(id: string, title: string, author: string): void;
  makeSearchable(id: string): void;
  getImage(id: string): CoverImageRow | undefined;
  insertImage(row: CoverImageRow): void;
  setCover(bookId: string, cover: { imageId: string | null; status: CoverStatus | null; checkedAt: string | null }): void;
  setCoverIf(bookId: string, expectedImageId: string | null, cover: { imageId: string | null; status: CoverStatus | null; checkedAt: string | null }): boolean;
  addRejection(bookId: string, sourceUrl: string, createdAt: string): void;
  listRejectedUrls(bookId: string): Set<string>;
  saveDetails(bookId: string, details: CatalogBookMetadata, sources: DataSource[], summarySource: DataSource | null, checkedAt: string): void;
  mergeDetails(bookId: string, details: MergeableDetails, summarySource: SummarySource | null): void;
  markDetailsMissing(bookId: string, checkedAt: string): void;
  markDetailsAttempted(bookId: string, checkedAt: string): void;
  searchBooks(tokens: string[], limit: number): BookRow[];
  listUncheckedCoverIds(after: PageCursor | null, limit: number): IdPage;
  listUncheckedDetailIds(limit: number): string[];
  setUpgradeWanted(bookId: string, at: string | null): void;
  setAppleChecked(bookId: string, at: string): void;
  setWorkKey(id: string, key: string | null | undefined): void;
  assignMissingWorks(limit: number): number;
  fillTitleKeys(limit: number): number;
  groupKeylessWorks(limit: number): number;
  listWorkLookupIds(limit: number, recheckBefore: string): string[];
  markWorkChecked(id: string, at: string): void;
  replaceLanguage(id: string, tag: string): void;
  mergeWorks(fromId: string, intoId: string): string;
  detachEdition(bookId: string, at: string): string;
  getWorkView(id: string): WorkView | undefined;
  workPageRows(id: string): WorkPageRows | undefined;
  assignWork(bookId: string): string;
  setWorkSummary(bookId: string, summary: string): void;
  getWorkSummary(bookId: string): { summary: string | null; olWorkKey: string | null } | undefined;
  canonicalWorkIds(ids: string[]): Map<string, string>;
  setLanguage(id: string, tag: string | null): void;
  setPublisherUrl(id: string, url: string): void;
  listUpgradeWantedIds(after: PageCursor | null, limit: number): IdPage;
}

export interface CoverCandidate {
  source: Exclude<CoverSourceName, "upload" | "publisher">;
  url: string;
}

export interface TitledCandidate extends CoverCandidate {
  title: string;
  authors: string[];
}

export interface CoverSource {
  byIsbn(isbn: string): Promise<CoverCandidate[]>;
  byTitle(title: string, author: string, accept: (candidate: TitledCandidate) => boolean, isbn?: string | null): Promise<CoverCandidate[]>;
}

export interface CatalogSearchHit {
  result: BookSearchResult;
  olCoverId: number | null;
  workKey?: string | null;
  source: DataSource;
}

export interface CatalogDetails {
  metadata: CatalogBookMetadata;
  sources: DataSource[];
  summarySource: DataSource | null;
  workKey?: string | null;
  workSummary?: string | null;
}

export interface BookCatalog {
  fetchDetails(lookup: { isbn: string | null; title: string; author: string; language?: string | null }): Promise<CatalogDetails | null>;
  search(query: { isbn: string } | { text: string }): Promise<CatalogSearchHit[]>;
}

export interface EditionRecord {
  title: string;
  workKey: string | null;
  languages: string[];
}

export interface EditionRecordSource {
  fetchEditionRecord(isbn: string): Promise<EditionRecord | null>;
}
