import { randomUUID } from "node:crypto";
import { findBestCover, type CoverSources, type FetchCoverImage } from "./coverResolver.js";
import { MIN_GOOD_WIDTH } from "./domain/constants.js";
import type { EncodedCover } from "./domain/images.js";
import { lookupIdentity, type BookLookup } from "./domain/normalize.js";
import type { BookCatalog, BooksRepository, CoverBlobStore } from "./domain/ports.js";
import type { BookRow, CoverSourceName, CoverStatus } from "./domain/types.js";

const RETRY_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const UNAVAILABLE_BACKOFF_MS = 10 * 60 * 1000;
const COVER_EXTENSION = "webp";
const COVER_MIME_TYPE = "image/webp";
const NO_COVER: ResolvedCover = { url: null, fullUrl: null, pending: false };

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
      const outcome = await findBestCover({ isbn: book.isbn, title: book.title, author: book.author }, deps.repo.listRejectedUrls(bookId), deps.sources, deps.fetchImage);

      const latest = deps.repo.getBook(bookId);
      if (!latest || latest.cover_status === "manual") return;
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
    },

    getCoverFile(id, size) {
      const buffer = size === "thumb"
        ? deps.blobs.read(`${id}-thumb`, COVER_EXTENSION) ?? deps.blobs.read(id, COVER_EXTENSION)
        : deps.blobs.read(id, COVER_EXTENSION);
      return buffer ? { buffer, mimeType: COVER_MIME_TYPE } : null;
    }
  };
}
