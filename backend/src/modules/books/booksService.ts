import { randomUUID } from "node:crypto";
import { looksLikeIsbnQuery, normalizeIsbn, type BookGenre, type BookMetadata, type BookSearchResult } from "@scripta/shared";
import { findBestCover, type CoverSources, type FetchCoverImage } from "./coverResolver.js";
import { MIN_GOOD_WIDTH } from "./domain/constants.js";
import { BookNotFoundError, FileTooLargeError, InvalidImageError, SourcePausedError, SourceUnavailableError, WorkMergeError } from "./domain/errors.js";
import { encodeCover, type EncodedCover } from "./domain/images.js";
import { editionLanguage, findByIdentity, isPortugueseIsbn, lookupIdentity, SEARCH_LIMIT, searchTokens, type BookIdentity, type BookLookup } from "./domain/normalize.js";
import type { BookCatalog, BooksRepository, CatalogSearchHit, CoverBlobStore, CoverSource, EditionRecordSource } from "./domain/ports.js";
import type { BookRow, CoverSourceName, CoverStatus, WorkView } from "./domain/types.js";
import type { CoverPriority } from "./worker.js";

const RETRY_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const WORK_RECHECK_MS = 30 * 24 * 60 * 60 * 1000;
const UNAVAILABLE_BACKOFF_MS = 10 * 60 * 1000;
const COVER_EXTENSION = "webp";
const NO_SOURCE: CoverSource = { byIsbn: async () => [], byTitle: async () => [] };
const NO_COVER: ResolvedCover = { url: null, fullUrl: null, pending: false, upgrading: false };
const PENDING: ResolvedCover = { url: null, fullUrl: null, pending: true, upgrading: false };

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export type CoverFileSize = "file" | "thumb";

export interface ResolvedCover {
  url: string | null;
  fullUrl: string | null;
  pending: boolean;
  upgrading: boolean;
}

export interface BooksServiceDeps {
  repo: BooksRepository;
  blobs: CoverBlobStore;
  sources: CoverSources;
  catalog: BookCatalog;
  backgroundCatalog: BookCatalog;
  editionRecords: EditionRecordSource;
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
  backfillDetails(limit: number, signal?: AbortSignal): Promise<number | null>;
  backfillWorkKeys(limit: number, signal?: AbortSignal): Promise<number | null>;
  search(query: string): BookSearchResult[];
  searchExternal(query: string): Promise<BookSearchResult[]>;
  isAdmin(userId: string): boolean;
  rejectCover(lookup: BookLookup): ResolvedCover;
  uploadCover(lookup: BookLookup, bytes: Buffer): Promise<ResolvedCover>;
  mergeWorks(from: BookLookup, into: BookLookup): WorkView;
  detachEdition(edition: BookLookup): WorkView;
}

export async function storeCoverImage(
  deps: { repo: Pick<BooksRepository, "insertImage">; blobs: CoverBlobStore },
  bookId: string,
  source: CoverSourceName,
  sourceUrl: string | null,
  image: EncodedCover,
  at: string,
  origin?: string
): Promise<string> {
  const id = randomUUID();
  await deps.blobs.save(id, COVER_EXTENSION, image.full);
  await deps.blobs.save(`${id}-thumb`, COVER_EXTENSION, image.thumb);
  deps.repo.insertImage({ id, book_id: bookId, source, source_url: sourceUrl, origin, width: image.width, height: image.height, byte_size: image.full.byteLength, created_at: at });
  return id;
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
      pending: false,
      upgrading: book.cover_upgrade_wanted_at !== null
    };
  }

  function sourcesFor(lane: CoverPriority, book: BookRow): CoverSources {
    if (lane === "front" || lane === "normal") return { apple: NO_SOURCE, isbndb: deps.sources.isbndb, openlibrary: deps.sources.openlibrary };
    if (lane === "upgrade") return { apple: deps.sources.apple, isbndb: null, openlibrary: NO_SOURCE };
    if (!olderThan(book.apple_checked_at, RETRY_AFTER_MS)) return { ...deps.sources, apple: NO_SOURCE };
    return deps.sources;
  }

  function schedule(bookId: string, priority: CoverPriority = "normal") {
    if ((backoffUntil.get(bookId) ?? 0) > now().getTime()) return;
    deps.enqueue(bookId, priority);
  }

  function openLibraryThumb(coverId: number | null): string | null {
    return coverId === null ? null : `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`;
  }

  function summaryLink(book: BookRow): string {
    if (book.summary_source === "publisher") return book.publisher_url ?? "";
    if (book.summary_source === "isbndb") return book.isbn ? `https://isbndb.com/book/${book.isbn}` : "";
    return book.source_url ?? "";
  }

  function detailsOf(book: BookRow): BookMetadata {
    return {
      summary: book.summary,
      rating: book.rating,
      ratingCount: book.rating_count,
      sourceUrl: summaryLink(book),
      genres: JSON.parse(book.genres) as BookGenre[],
      pages: book.pages,
      publisher: book.publisher,
      year: book.year,
      translator: book.translator,
      summarySource: book.summary_source
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
    return hits.map(({ result, olCoverId, workKey, source }) => {
      const author = result.authors.join(", ");
      const identity = lookupIdentity({ isbn: result.isbn, title: result.title, author });
      if (!identity) return result;
      const book = findExisting(identity) ?? deps.repo.createBook(
        { title: result.title, author, isbn: identity.isbn, year: result.year, publisher: result.publisher, olCoverId, workKey, genres: result.genres, sources: [source] },
        keysOf(identity),
        now().toISOString()
      );
      if (!book.title) deps.repo.fillIdentity(book.id, result.title, author);
      deps.repo.setWorkKey(book.id, workKey);
      deps.repo.makeSearchable(book.id);
      return book.cover_image_id ? { ...result, coverUrl: deps.publicUrlFor(book.cover_image_id, "thumb") } : result;
    });
  }

  function existingEdition(lookup: BookLookup): BookRow {
    const identity = lookupIdentity(lookup);
    if (lookup.isbn?.trim() && !identity?.isbn) throw new BookNotFoundError();
    const book = identity ? (identity.isbn ? deps.repo.findBookByKey(identity.key) : findByIdentity(deps.repo, identity)) : undefined;
    if (!book) throw new BookNotFoundError();
    return book;
  }

  function workView(workId: string): WorkView {
    const view = deps.repo.getWorkView(workId);
    if (!view) throw new Error(`Work ${workId} is missing.`);
    return view;
  }

  async function lookupDetails(book: BookRow, catalog: BookCatalog) {
    const details = await catalog.fetchDetails({ isbn: book.isbn, title: book.title, author: book.author });
    const at = now().toISOString();
    if (details && (details.metadata.summary || details.metadata.genres.length > 0 || details.metadata.rating !== null)) {
      deps.repo.saveDetails(book.id, details.metadata, details.sources, details.summarySource, at);
      deps.repo.setWorkKey(book.id, details.workKey);
      return;
    }
    if (details) {
      deps.repo.mergeDetails(book.id, { ...details.metadata, summary: null }, null);
      deps.repo.setWorkKey(book.id, details.workKey);
    }
    deps.repo.markDetailsMissing(book.id, at);
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
      for (const id of deps.repo.listUpgradeWantedIds()) schedule(id, "upgrade");
    },

    async processBook(bookId, lane) {
      const book = deps.repo.getBook(bookId);
      if (!book || book.cover_status === "manual") return;
      try {
        const sources = sourcesFor(lane, book);
        const outcome = await findBestCover({ isbn: book.isbn, title: book.title, author: book.author }, deps.repo.listRejectedUrls(bookId), sources, deps.fetchImage);
        if (sources.apple !== NO_SOURCE && !outcome.failures.some((failure) => failure.source === "apple")) deps.repo.setAppleChecked(bookId, now().toISOString());
        for (const failure of outcome.failures.filter((failure) => !(failure instanceof SourcePausedError))) deps.warn({ bookId, source: failure.source, error: failure.message }, "cover source unavailable");

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
          imageId = await storeCoverImage(deps, bookId, found.candidate.source, found.candidate.url, found.image, at);
          width = found.image.width;
          source = found.candidate.source;
        }
        const status: CoverStatus = imageId === null ? "missing" : width >= MIN_GOOD_WIDTH ? "good" : "low_res";

        if (outcome.complete) {
          backoffUntil.delete(bookId);
          if (!deps.repo.setCoverIf(bookId, latest.cover_image_id, { imageId, status, checkedAt: at })) return;
          if (lane === "upgrade") {
            deps.repo.setUpgradeWanted(bookId, null);
          } else if (lane !== "background") {
            const wanted = status !== "good" || (source === "isbndb" && portuguese);
            deps.repo.setUpgradeWanted(bookId, wanted ? at : null);
            if (wanted) schedule(bookId, "upgrade");
          }
          return;
        }
        backoffUntil.set(bookId, Math.max(now().getTime() + UNAVAILABLE_BACKOFF_MS, ...outcome.failures.map((failure) => failure.retryAt ?? 0)));
        if (imageId !== latest.cover_image_id) deps.repo.setCoverIf(bookId, latest.cover_image_id, { imageId, status, checkedAt: latest.cover_checked_at });
      } catch (error) {
        backoffUntil.set(bookId, now().getTime() + UNAVAILABLE_BACKOFF_MS);
        throw error;
      }
    },

    async getDetails(lookup) {
      const book = findOrCreate(lookup);
      if (!book) return null;
      if (book.details_status === "found") return detailsOf(book);
      if (book.details_status === "missing" && !olderThan(book.details_checked_at, RETRY_AFTER_MS)) return book.summary ? detailsOf(book) : null;
      try {
        await lookupDetails(book, deps.catalog);
      } catch (error) {
        if (error instanceof SourceUnavailableError && book.summary) return detailsOf(book);
        throw error;
      }
      const latest = deps.repo.getBook(book.id) ?? book;
      return latest.details_status === "found" || latest.summary ? detailsOf(latest) : null;
    },

    async backfillDetails(limit, signal) {
      for (const id of deps.repo.listUncheckedDetailIds(limit)) {
        if (signal?.aborted) return null;
        const book = deps.repo.getBook(id);
        if (!book || book.details_status !== null) continue;
        try {
          await lookupDetails(book, deps.backgroundCatalog);
        } catch (error) {
          if (error instanceof SourcePausedError) return error.retryAt;
          if (!(error instanceof SourceUnavailableError)) throw error;
          deps.repo.markDetailsAttempted(id, now().toISOString());
          deps.warn({ bookId: id, source: error.source, error: error.message }, "details source unavailable");
        }
      }
      return null;
    },

    async backfillWorkKeys(limit, signal) {
      const recheckBefore = new Date(now().getTime() - WORK_RECHECK_MS).toISOString();
      for (const id of deps.repo.listWorkLookupIds(limit, recheckBefore)) {
        if (signal?.aborted) return null;
        const book = deps.repo.getBook(id);
        if (!book?.isbn || book.ol_work_key) continue;
        try {
          const record = await deps.editionRecords.fetchEditionRecord(book.isbn);
          if (record?.workKey) {
            deps.repo.setWorkKey(id, record.workKey);
            const language = editionLanguage(record.languages, book.isbn);
            if (language) deps.repo.replaceLanguage(id, language);
          }
        } catch (error) {
          if (!(error instanceof SourceUnavailableError)) throw error;
          if (error.retryAt !== undefined) return error.retryAt;
          if (error.status === 429) return now().getTime() + UNAVAILABLE_BACKOFF_MS;
          deps.warn({ bookId: id, source: error.source, error: error.message }, "work key source unavailable");
        }
        deps.repo.markWorkChecked(id, now().toISOString());
      }
      return null;
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
      return { url: null, fullUrl: null, pending: true, upgrading: false };
    },

    mergeWorks(from, into) {
      const source = existingEdition(from);
      const target = existingEdition(into);
      if (!source.work_id || !target.work_id) throw new WorkMergeError("That edition has no work yet.");
      return workView(deps.repo.mergeWorks(source.work_id, target.work_id));
    },

    detachEdition(edition) {
      return workView(deps.repo.detachEdition(existingEdition(edition).id, now().toISOString()));
    },

    async uploadCover(lookup, bytes) {
      if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new FileTooLargeError(MAX_UPLOAD_BYTES);
      if (!lookupIdentity(lookup)) throw new BookNotFoundError();
      const image = await encodeCover(bytes);
      if (!image) throw new InvalidImageError();
      const book = findOrCreate(lookup);
      if (!book) throw new BookNotFoundError();
      const at = now().toISOString();
      const imageId = await storeCoverImage(deps, book.id, "upload", null, image, at);
      deps.repo.setCover(book.id, { imageId, status: "manual", checkedAt: at });
      deps.repo.setUpgradeWanted(book.id, null);
      backoffUntil.delete(book.id);
      return coverOf(deps.repo.getBook(book.id) ?? book);
    }
  };
}
