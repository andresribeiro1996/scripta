import type { BookMetadata, BookSearchResult, CatalogBookMetadata } from "@scripta/shared";
import type { BookRow, CoverImageRow, CoverSourceName, CoverStatus, DataSource, NewBook, SummarySource } from "./types.js";

export type MergeableDetails = Pick<BookMetadata, "summary" | "pages" | "year" | "publisher" | "translator">;

export interface CoverBlobStore {
  save(id: string, extension: string, bytes: Buffer): Promise<void>;
}

export interface BooksRepository {
  findBookByKey(key: string): BookRow | undefined;
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
  listUncheckedCoverIds(): string[];
  listUncheckedDetailIds(limit: number): string[];
  setUpgradeWanted(bookId: string, at: string | null): void;
  setWorkKey(id: string, key: string | null | undefined): void;
  setPublisherUrl(id: string, url: string): void;
  listUpgradeWantedIds(): string[];
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
  byTitle(title: string, author: string, accept: (candidate: TitledCandidate) => boolean): Promise<CoverCandidate[]>;
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
}

export interface BookCatalog {
  fetchDetails(lookup: { isbn: string | null; title: string; author: string }): Promise<CatalogDetails | null>;
  search(query: { isbn: string } | { text: string }): Promise<CatalogSearchHit[]>;
}
