import { randomUUID } from "node:crypto";
import { looksLikeIsbnQuery, normalizeIsbn, type BookGenre, type BookMetadata, type BookSearchResult } from "@scripta/shared";
import { findBestCover, type CoverSources, type FetchCoverImage } from "./coverResolver.js";
import { MIN_GOOD_WIDTH } from "./domain/constants.js";
import { BookNotFoundError, FileTooLargeError, InvalidImageError } from "./domain/errors.js";
import { encodeCover, type EncodedCover } from "./domain/images.js";
import { lookupIdentity, searchTokens, type BookLookup } from "./domain/normalize.js";
import type { BookCatalog, BooksRepository, CatalogSearchHit, CoverBlobStore } from "./domain/ports.js";
import type { BookRow, CoverSourceName, CoverStatus } from "./domain/types.js";

const RETRY_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const UNAVAILABLE_BACKOFF_MS = 10 * 60 * 1000;
const SEARCH_LIMIT = 12;
const COVER_EXTENSION = "webp";
const COVER_MIME_TYPE = "image/webp";
const NO_COVER: ResolvedCover = { url: null, fullUrl: null, pending: false };

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export type CoverFileSize = "file" | "thumb";

export interface ResolvedCover {
  url: string | null;
  fullUrl: string | null;
  pending: boolean;
}

export interface BooksServiceDeps {
  repo: BooksRepository;
  blobs: CoverBlobStore;
  sources: CoverSources;
  catalog: BookCatalog;
  fetchImage: FetchCoverImage;
  enqueue: (bookId: string, front?: boolean) => void;
  publicUrlFor: (imageId: string, size: CoverFileSize) => string;
  adminUserId: string;
  now?: () => Date;
}

export interface BooksService {
  resolveCover(lookup: BookLookup): ResolvedCover;
  processBook(bookId: string): Promise<void>;
  getCoverFile(id: string, size: CoverFileSize): { buffer: Buffer; mimeType: string } | null;
  getDetails(lookup: BookLookup): Promise<BookMetadata | null>;
  search(query: string): Promise<BookSearchResult[]>;
  isAdmin(userId: string): boolean;
  rejectCover(lookup: BookLookup): ResolvedCover;
  uploadCover(lookup: BookLookup, bytes: Buffer): Promise<ResolvedCover>;
}

export function createBooksService(deps: BooksServiceDeps): BooksService {
  const now = deps.now ?? (() => new Date());
  const backoffUntil = new Map<string, number>();

  const olderThan = (iso: string | null, ms: number) => iso === null || now().getTime() - Date.parse(iso) >= ms;

  function findOrCreate(lookup: BookLookup): BookRow | null {
    const identity = lookupIdentity(lookup);
    if (!identity) return null;
    const existing = deps.repo.findBookByKey(identity.key);
    if (!existing) {
      return deps.repo.createBook({ title: identity.title, author: identity.author, isbn: identity.isbn }, identity.key, now().toISOString());
    }
    if (!existing.title && identity.title) {
      deps.repo.fillIdentity(existing.id, identity.title, identity.author);
      return deps.repo.getBook(existing.id) ?? existing;
    }
    return existing;
  }

  function coverOf(book: BookRow): ResolvedCover {
    if (!book.cover_image_id) return NO_COVER;
    return {
      url: deps.publicUrlFor(book.cover_image_id, "thumb"),
      fullUrl: deps.publicUrlFor(book.cover_image_id, "file"),
      pending: false
    };
  }

  function schedule(bookId: string): boolean {
    if ((backoffUntil.get(bookId) ?? 0) > now().getTime()) return false;
    deps.enqueue(bookId);
    return true;
  }

  function storeImage(bookId: string, source: CoverSourceName, sourceUrl: string | null, image: EncodedCover, at: string): string {
    const id = randomUUID();
    deps.blobs.save(id, COVER_EXTENSION, image.full);
    deps.blobs.save(`${id}-thumb`, COVER_EXTENSION, image.thumb);
    deps.repo.insertImage({ id, book_id: bookId, source, source_url: sourceUrl, width: image.width, height: image.height, byte_size: image.full.byteLength, created_at: at });
    return id;
  }

  function openLibraryThumb(coverId: number | null): string | null {
    return coverId === null ? null : `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`;
  }

  function detailsOf(book: BookRow): BookMetadata {
    return {
      summary: book.summary,
      rating: book.rating,
      ratingCount: book.rating_count,
      sourceUrl: book.source_url ?? "",
      genres: JSON.parse(book.genres) as BookGenre[]
    };
  }

  function toSearchResult(book: BookRow): BookSearchResult {
    return {
      title: book.title,
      authors: book.author ? book.author.split(", ") : [],
      year: book.year,
      isbn: book.isbn,
      publisher: book.publisher,
      coverUrl: book.cover_image_id ? deps.publicUrlFor(book.cover_image_id, "thumb") : openLibraryThumb(book.ol_cover_id),
      genres: JSON.parse(book.genres) as BookGenre[]
    };
  }

  function saveHits(hits: CatalogSearchHit[]): BookSearchResult[] {
    return hits.map(({ result, olCoverId }) => {
      const author = result.authors.join(", ");
      const identity = lookupIdentity({ isbn: result.isbn, title: result.title, author });
      if (!identity) return result;
      const book = deps.repo.findBookByKey(identity.key) ?? deps.repo.createBook(
        { title: result.title, author, isbn: identity.isbn, year: result.year, publisher: result.publisher, olCoverId, genres: result.genres },
        identity.key,
        now().toISOString()
      );
      if (!book.title) deps.repo.fillIdentity(book.id, result.title, author);
      return book.cover_image_id ? { ...result, coverUrl: deps.publicUrlFor(book.cover_image_id, "thumb") } : result;
    });
  }

  return {
    resolveCover(lookup) {
      const book = findOrCreate(lookup);
      if (!book) return NO_COVER;
      if (book.cover_image_id) {
        if (book.cover_status === "low_res" && olderThan(book.cover_checked_at, RETRY_AFTER_MS)) schedule(book.id);
        return coverOf(book);
      }
      if (book.cover_status === "missing" && !olderThan(book.cover_checked_at, RETRY_AFTER_MS)) return NO_COVER;
      return { url: null, fullUrl: null, pending: schedule(book.id) };
    },

    async processBook(bookId) {
      const book = deps.repo.getBook(bookId);
      if (!book || book.cover_status === "manual") return;
      try {
        const outcome = await findBestCover({ isbn: book.isbn, title: book.title, author: book.author }, deps.repo.listRejectedUrls(bookId), deps.sources, deps.fetchImage);

        const latest = deps.repo.getBook(bookId);
        if (!latest || latest.cover_image_id !== book.cover_image_id || latest.cover_status !== book.cover_status) return;
        const current = latest.cover_image_id ? deps.repo.getImage(latest.cover_image_id) : undefined;
        const at = now().toISOString();
        let imageId = latest.cover_image_id;
        let width = current?.width ?? 0;
        if (outcome.found && outcome.found.image.width > width) {
          imageId = storeImage(bookId, outcome.found.candidate.source, outcome.found.candidate.url, outcome.found.image, at);
          width = outcome.found.image.width;
        }
        const status: CoverStatus = imageId === null ? "missing" : width >= MIN_GOOD_WIDTH ? "good" : "low_res";

        if (outcome.complete) {
          backoffUntil.delete(bookId);
          deps.repo.setCover(bookId, { imageId, status, checkedAt: at });
          return;
        }
        backoffUntil.set(bookId, now().getTime() + UNAVAILABLE_BACKOFF_MS);
        if (imageId !== latest.cover_image_id) deps.repo.setCover(bookId, { imageId, status, checkedAt: latest.cover_checked_at });
      } catch (error) {
        backoffUntil.set(bookId, now().getTime() + UNAVAILABLE_BACKOFF_MS);
        throw error;
      }
    },

    getCoverFile(id, size) {
      const buffer = size === "thumb"
        ? deps.blobs.read(`${id}-thumb`, COVER_EXTENSION) ?? deps.blobs.read(id, COVER_EXTENSION)
        : deps.blobs.read(id, COVER_EXTENSION);
      return buffer ? { buffer, mimeType: COVER_MIME_TYPE } : null;
    },

    async getDetails(lookup) {
      const book = findOrCreate(lookup);
      if (!book) return null;
      if (book.details_status === "found") return detailsOf(book);
      if (book.details_status === "missing" && !olderThan(book.details_checked_at, RETRY_AFTER_MS)) return null;
      const metadata = await deps.catalog.fetchDetails({ isbn: book.isbn, title: book.title, author: book.author });
      const at = now().toISOString();
      if (metadata) deps.repo.saveDetails(book.id, metadata, at);
      else deps.repo.markDetailsMissing(book.id, at);
      return metadata;
    },

    async search(query) {
      const trimmed = query.trim();
      if (!trimmed) return [];
      if (looksLikeIsbnQuery(trimmed)) {
        const isbn = normalizeIsbn(trimmed);
        const saved = isbn ? deps.repo.findBookByKey(`isbn:${isbn}`) : undefined;
        if (saved) return [toSearchResult(saved)];
        return saveHits(await deps.catalog.search({ isbn: isbn || trimmed.replace(/[\s-]/g, "") }));
      }
      const tokens = searchTokens(trimmed);
      if (tokens.length === 0) return [];
      const saved = deps.repo.searchBooks(tokens, SEARCH_LIMIT);
      if (saved.length > 0) return saved.map(toSearchResult);
      return saveHits(await deps.catalog.search({ text: trimmed }));
    },

    isAdmin(userId) {
      return deps.adminUserId !== "" && userId === deps.adminUserId;
    },

    rejectCover(lookup) {
      const identity = lookupIdentity(lookup);
      const book = identity ? deps.repo.findBookByKey(identity.key) : undefined;
      if (!book) throw new BookNotFoundError();
      const image = book.cover_image_id ? deps.repo.getImage(book.cover_image_id) : undefined;
      if (image?.source_url) deps.repo.addRejection(book.id, image.source_url, now().toISOString());
      deps.repo.setCover(book.id, { imageId: null, status: null, checkedAt: null });
      backoffUntil.delete(book.id);
      deps.enqueue(book.id, true);
      return { url: null, fullUrl: null, pending: true };
    },

    async uploadCover(lookup, bytes) {
      if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new FileTooLargeError(MAX_UPLOAD_BYTES);
      if (!lookupIdentity(lookup)) throw new BookNotFoundError();
      const image = await encodeCover(bytes);
      if (!image) throw new InvalidImageError();
      const book = findOrCreate(lookup);
      if (!book) throw new BookNotFoundError();
      const at = now().toISOString();
      const imageId = storeImage(book.id, "upload", null, image, at);
      deps.repo.setCover(book.id, { imageId, status: "manual", checkedAt: at });
      backoffUntil.delete(book.id);
      return coverOf(deps.repo.getBook(book.id) ?? book);
    }
  };
}
