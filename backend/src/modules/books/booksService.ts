import { randomUUID } from "node:crypto";
import { looksLikeIsbnQuery, normalizeIsbn, type BookGenre, type BookMetadata, type BookSearchResult } from "@scripta/shared";
import { findBestCover, type CoverSources, type FetchCoverImage } from "./coverResolver.js";
import { MIN_GOOD_WIDTH } from "./domain/constants.js";
import { BookNotFoundError, FileTooLargeError, InvalidImageError } from "./domain/errors.js";
import { encodeCover, type EncodedCover } from "./domain/images.js";
import { findByIdentity, isPortugueseIsbn, lookupIdentity, SEARCH_LIMIT, searchTokens, type BookIdentity, type BookLookup } from "./domain/normalize.js";
import type { BookCatalog, BooksRepository, CatalogSearchHit, CoverBlobStore, CoverSource } from "./domain/ports.js";
import type { BookRow, CoverSourceName, CoverStatus } from "./domain/types.js";
import type { CoverPriority } from "./worker.js";

const RETRY_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const UNAVAILABLE_BACKOFF_MS = 10 * 60 * 1000;
const COVER_EXTENSION = "webp";
const NO_SOURCE: CoverSource = { byIsbn: async () => [], byTitle: async () => [] };
const NO_COVER: ResolvedCover = { url: null, fullUrl: null, pending: false };
const PENDING: ResolvedCover = { url: null, fullUrl: null, pending: true };

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
  enqueue: (bookId: string, priority?: CoverPriority) => void;
  publicUrlFor: (imageId: string, size: CoverFileSize) => string;
  adminUserId: string;
  warn: (details: Record<string, unknown>, message: string) => void;
  now?: () => Date;
}

export interface BooksService {
  resolveCover(lookup: BookLookup, front?: boolean): ResolvedCover;
  enqueueCovers(lookups: BookLookup[]): void;
  enqueueUnchecked(): void;
  processBook(bookId: string, lane: CoverPriority): Promise<void>;
  getDetails(lookup: BookLookup): Promise<BookMetadata | null>;
  search(query: string): BookSearchResult[];
  searchExternal(query: string): Promise<BookSearchResult[]>;
  isAdmin(userId: string): boolean;
  rejectCover(lookup: BookLookup): ResolvedCover;
  uploadCover(lookup: BookLookup, bytes: Buffer): Promise<ResolvedCover>;
}

export function createBooksService(deps: BooksServiceDeps): BooksService {
  const now = deps.now ?? (() => new Date());
  const backoffUntil = new Map<string, number>();

  const olderThan = (iso: string | null, ms: number) => iso === null || now().getTime() - Date.parse(iso) >= ms;

  function keysOf(identity: BookIdentity): string[] {
    const titleKey = identity.titleKey;
    return titleKey && titleKey !== identity.key && !deps.repo.findBookByKey(titleKey) ? [identity.key, titleKey] : [identity.key];
  }

  function findExisting(identity: BookIdentity): BookRow | undefined {
    const direct = deps.repo.findBookByKey(identity.key);
    if (direct) return direct;
    const byTitle = findByIdentity(deps.repo, identity);
    if (!byTitle || byTitle.isbn) return undefined;
    deps.repo.addKey(identity.key, byTitle.id);
    return byTitle;
  }

  function findOrCreate(lookup: BookLookup): BookRow | null {
    const identity = lookupIdentity(lookup);
    if (!identity) return null;
    const existing = findExisting(identity);
    if (!existing) {
      return deps.repo.createBook({ title: identity.title, author: identity.author, isbn: identity.isbn }, keysOf(identity), now().toISOString());
    }
    if (!existing.title && identity.title) {
      if (identity.titleKey) deps.repo.addKey(identity.titleKey, existing.id);
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

  function sourcesFor(lane: CoverPriority): CoverSources {
    if (lane === "front" || lane === "normal") return { apple: NO_SOURCE, isbndb: deps.sources.isbndb, openlibrary: deps.sources.openlibrary };
    if (lane === "upgrade") return { apple: deps.sources.apple, isbndb: null, openlibrary: NO_SOURCE };
    return deps.sources;
  }

  function schedule(bookId: string, priority: CoverPriority = "normal") {
    if ((backoffUntil.get(bookId) ?? 0) > now().getTime()) return;
    deps.enqueue(bookId, priority);
  }

  async function storeImage(bookId: string, source: CoverSourceName, sourceUrl: string | null, image: EncodedCover, at: string): Promise<string> {
    const id = randomUUID();
    await deps.blobs.save(id, COVER_EXTENSION, image.full);
    await deps.blobs.save(`${id}-thumb`, COVER_EXTENSION, image.thumb);
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
    return hits.map(({ result, olCoverId, source }) => {
      const author = result.authors.join(", ");
      const identity = lookupIdentity({ isbn: result.isbn, title: result.title, author });
      if (!identity) return result;
      const book = findExisting(identity) ?? deps.repo.createBook(
        { title: result.title, author, isbn: identity.isbn, year: result.year, publisher: result.publisher, olCoverId, genres: result.genres, sources: [source] },
        keysOf(identity),
        now().toISOString()
      );
      if (!book.title) deps.repo.fillIdentity(book.id, result.title, author);
      deps.repo.makeSearchable(book.id);
      return book.cover_image_id ? { ...result, coverUrl: deps.publicUrlFor(book.cover_image_id, "thumb") } : result;
    });
  }

  return {
    resolveCover(lookup, front = false) {
      const book = findOrCreate(lookup);
      if (!book) return NO_COVER;
      if (book.cover_image_id) {
        if (book.cover_status === "low_res" && olderThan(book.cover_checked_at, RETRY_AFTER_MS)) schedule(book.id, front ? "front" : "normal");
        return coverOf(book);
      }
      if (book.cover_status === "missing" && !olderThan(book.cover_checked_at, RETRY_AFTER_MS)) return NO_COVER;
      schedule(book.id, front ? "front" : "normal");
      return PENDING;
    },

    enqueueCovers(lookups) {
      for (const lookup of lookups) this.resolveCover(lookup);
    },

    enqueueUnchecked() {
      for (const id of deps.repo.listUncheckedCoverIds()) schedule(id, "background");
    },

    async processBook(bookId, lane) {
      const book = deps.repo.getBook(bookId);
      if (!book || book.cover_status === "manual") return;
      try {
        const outcome = await findBestCover({ isbn: book.isbn, title: book.title, author: book.author }, deps.repo.listRejectedUrls(bookId), sourcesFor(lane), deps.fetchImage);
        for (const failure of outcome.failures) deps.warn({ bookId, source: failure.source, error: failure.message }, "cover source unavailable");

        const latest = deps.repo.getBook(bookId);
        if (!latest || latest.cover_image_id !== book.cover_image_id || latest.cover_status !== book.cover_status) return;
        const current = latest.cover_image_id ? deps.repo.getImage(latest.cover_image_id) : undefined;
        const at = now().toISOString();
        let imageId = latest.cover_image_id;
        let width = current?.width ?? 0;
        let source = current?.source;
        const portuguese = isPortugueseIsbn(book.isbn);
        const found = outcome.found;
        const replacesWatermark = lane === "upgrade" && found !== null && found.image.width >= MIN_GOOD_WIDTH && source === "isbndb" && portuguese;
        if (found && (found.image.width > width || replacesWatermark)) {
          imageId = await storeImage(bookId, found.candidate.source, found.candidate.url, found.image, at);
          width = found.image.width;
          source = found.candidate.source;
        }
        const status: CoverStatus = imageId === null ? "missing" : width >= MIN_GOOD_WIDTH ? "good" : "low_res";

        if (outcome.complete) {
          backoffUntil.delete(bookId);
          deps.repo.setCover(bookId, { imageId, status, checkedAt: at });
          const fast = lane === "front" || lane === "normal";
          if (fast && (status !== "good" || (source === "isbndb" && portuguese))) schedule(bookId, "upgrade");
          return;
        }
        backoffUntil.set(bookId, now().getTime() + UNAVAILABLE_BACKOFF_MS);
        if (imageId !== latest.cover_image_id) deps.repo.setCover(bookId, { imageId, status, checkedAt: latest.cover_checked_at });
      } catch (error) {
        backoffUntil.set(bookId, now().getTime() + UNAVAILABLE_BACKOFF_MS);
        throw error;
      }
    },

    async getDetails(lookup) {
      const book = findOrCreate(lookup);
      if (!book) return null;
      if (book.details_status === "found") return detailsOf(book);
      if (book.details_status === "missing" && !olderThan(book.details_checked_at, RETRY_AFTER_MS)) return null;
      const details = await deps.catalog.fetchDetails({ isbn: book.isbn, title: book.title, author: book.author });
      const at = now().toISOString();
      if (details) deps.repo.saveDetails(book.id, details.metadata, details.sources, at);
      else deps.repo.markDetailsMissing(book.id, at);
      return details?.metadata ?? null;
    },

    search(query) {
      const trimmed = query.trim();
      if (!trimmed) return [];
      if (looksLikeIsbnQuery(trimmed)) {
        const saved = deps.repo.findBookByKey(`isbn:${normalizeIsbn(trimmed)}`);
        return saved && saved.data_sources !== "[]" ? [toSearchResult(saved)] : [];
      }
      const tokens = searchTokens(trimmed);
      return tokens.length === 0 ? [] : deps.repo.searchBooks(tokens, SEARCH_LIMIT).map(toSearchResult);
    },

    async searchExternal(query) {
      const trimmed = query.trim();
      if (!trimmed) return [];
      if (looksLikeIsbnQuery(trimmed)) return saveHits(await deps.catalog.search({ isbn: normalizeIsbn(trimmed) }));
      if (searchTokens(trimmed).length === 0) return [];
      return saveHits(await deps.catalog.search({ text: trimmed }));
    },

    isAdmin(userId) {
      return deps.adminUserId !== "" && userId === deps.adminUserId;
    },

    rejectCover(lookup) {
      const identity = lookupIdentity(lookup);
      const book = identity ? findByIdentity(deps.repo, identity) : undefined;
      if (!book) throw new BookNotFoundError();
      const image = book.cover_image_id ? deps.repo.getImage(book.cover_image_id) : undefined;
      if (image?.source_url) deps.repo.addRejection(book.id, image.source_url, now().toISOString());
      deps.repo.setCover(book.id, { imageId: null, status: null, checkedAt: null });
      backoffUntil.delete(book.id);
      deps.enqueue(book.id, "front");
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
      const imageId = await storeImage(book.id, "upload", null, image, at);
      deps.repo.setCover(book.id, { imageId, status: "manual", checkedAt: at });
      backoffUntil.delete(book.id);
      return coverOf(deps.repo.getBook(book.id) ?? book);
    }
  };
}
