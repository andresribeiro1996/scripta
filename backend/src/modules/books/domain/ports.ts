import type { BookMetadata, BookSearchResult } from "@scripta/shared";
import type { BookRow, CoverImageRow, CoverSourceName, CoverStatus, NewBook } from "./types.js";

export interface CoverBlobStore {
  save(id: string, extension: string, bytes: Buffer): void;
  read(id: string, extension: string): Buffer | null;
}

export interface BooksRepository {
  findBookByKey(key: string): BookRow | undefined;
  getBook(id: string): BookRow | undefined;
  createBook(input: NewBook, key: string, createdAt: string): BookRow;
  fillIdentity(id: string, title: string, author: string): void;
  makeSearchable(id: string): void;
  getImage(id: string): CoverImageRow | undefined;
  insertImage(row: CoverImageRow): void;
  setCover(bookId: string, cover: { imageId: string | null; status: CoverStatus | null; checkedAt: string | null }): void;
  addRejection(bookId: string, sourceUrl: string, createdAt: string): void;
  listRejectedUrls(bookId: string): Set<string>;
  saveDetails(bookId: string, details: BookMetadata, checkedAt: string): void;
  markDetailsMissing(bookId: string, checkedAt: string): void;
  searchBooks(tokens: string[], limit: number): BookRow[];
  listUncheckedCoverIds(): string[];
}

export interface CoverCandidate {
  source: Exclude<CoverSourceName, "upload">;
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
}

export interface BookCatalog {
  fetchDetails(lookup: { isbn: string | null; title: string; author: string }): Promise<BookMetadata | null>;
  search(query: { isbn: string } | { text: string }): Promise<CatalogSearchHit[]>;
}
