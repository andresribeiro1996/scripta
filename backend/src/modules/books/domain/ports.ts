import type { BookMetadata, BookSearchResult } from "@scripta/shared";
import type { BookRow, CachedCoverRow, CoverImageRow, CoverSourceName, CoverStatus, NewBook } from "./types.js";

// The one seam Hardcover specifically needs — something that can look up
// a cover image URL for a book, given its ISBN. Written in terms the
// DOMAIN cares about ("find a cover for this ISBN"), not Hardcover's own
// GraphQL shape — same reasoning modules/auth's/modules/library's own
// ports.ts files give for their own repository interfaces. Hardcover is
// the first implementation (see adapters/hardcover/) but not necessarily
// the last one this app tries — a second cover-lookup source is a new
// adapter implementing this same port, not a rewrite of service.ts/
// routes.ts. Kobo/Open Library/Google Books aren't modeled behind this
// same port — service.ts's own comment explains why: their real ordering
// (some keyed by ISBN, some by Kobo's own imageId, some by fuzzy
// title/author, in a specific hand-tuned priority order) doesn't fit one
// generic interface honestly, so they're plain functions service.ts
// orchestrates directly instead.
export interface CoverLookupPort {
  fetchCoverByIsbn(isbn: string): Promise<string | null>;
}

// The two seams the cache itself needs — row metadata (small, searchable
// by cache_key) and raw image bytes (large, write-once), same split
// gallery's own GalleryRepository/ImageBlobStore ports use, for the same
// reason: SQLite backing the former and the filesystem backing the
// latter shouldn't have to pretend to be the same port.
export interface CoverCacheRepository {
  getByCacheKey(cacheKey: string): CachedCoverRow | undefined;
  /** Returns `true` if this call actually inserted the row, `false` if a
   *  concurrent call for the same `cache_key` already won that race —
   *  see the SQLite adapter's own comment for why this can genuinely
   *  happen and isn't a bug when it does. */
  insert(row: CachedCoverRow): boolean;
}

export interface CoverBlobStore {
  save(id: string, extension: string, bytes: Buffer): void;
  read(id: string, extension: string): Buffer | null;
}

export interface BooksRepository {
  findBookByKey(key: string): BookRow | undefined;
  getBook(id: string): BookRow | undefined;
  createBook(input: NewBook, key: string, createdAt: string): BookRow;
  fillIdentity(id: string, title: string, author: string): void;
  getImage(id: string): CoverImageRow | undefined;
  insertImage(row: CoverImageRow): void;
  setCover(bookId: string, cover: { imageId: string | null; status: CoverStatus | null; checkedAt: string | null }): void;
  addRejection(bookId: string, sourceUrl: string, createdAt: string): void;
  listRejectedUrls(bookId: string): Set<string>;
  saveDetails(bookId: string, details: BookMetadata, checkedAt: string): void;
  markDetailsMissing(bookId: string, checkedAt: string): void;
  searchBooks(tokens: string[], limit: number): BookRow[];
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
