// Business logic — the actual "resolve a book's cover, checking the
// global cache first" orchestration. Written against CoverCacheRepository/
// CoverBlobStore/CoverLookupPort (Hardcover) only, same "no idea what's
// on the other side of a port" rule every other module's service.ts
// follows — plugin.ts is the one place that wires in the real SQLite/
// filesystem/Hardcover implementations.
//
// Kobo/Open Library/Google Books are the one deliberate exception to
// "everything outside-world goes behind an injected port": they're
// imported directly from their own adapters/ files below, not injected.
// Unlike Hardcover (which genuinely anticipates a swappable/alternative
// provider — see domain/ports.ts's own comment), each of these three has
// exactly one real implementation, is keyless, and needs no
// configuration at all — there's nothing to swap and nothing a fake
// double would ever stand in for in a test that a real integration check
// against the live API wouldn't already need anyway. Forcing them behind
// single-use ports would be ceremony standing in for a testability need
// that doesn't actually exist here. The frontend's own lib/covers.ts
// (now this module's ancestor in spirit) drew the same line, for the
// same reason.

import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { searchGoogleBooksCoverByIsbnUrl, searchGoogleBooksCoverUrl } from "./adapters/google/googleBooksCoverLookup.js";
import { koboCoverUrl } from "./adapters/kobo/koboCoverLookup.js";
import { openLibraryCoverUrl, searchOpenLibraryCoverUrl } from "./adapters/openlibrary/openLibraryCoverLookup.js";
import type { CoverBlobStore, CoverCacheRepository, CoverLookupPort } from "./domain/ports.js";
import type { CachedCoverRow } from "./domain/types.js";

const MAX_INPUT_DIMENSION = 8000; // decompression-bomb guard, same cap gallery's own pipeline uses
const OUTPUT_MAX_DIMENSION = 1600; // a book cover is never usefully bigger than this
const OUTPUT_QUALITY = 85;
const OUTPUT_MIME_TYPE = "image/webp";
const OUTPUT_EXTENSION = "webp";
const FETCH_TIMEOUT_MS = 8000; // one slow/hung external source shouldn't stall the whole chain indefinitely

export interface ResolveCoverParams {
  isbn?: string;
  imageId?: string;
  title?: string;
  author?: string;
}

export interface CoversService {
  resolveCover(params: ResolveCoverParams): Promise<{ url: string | null }>;
  getCachedCoverFile(id: string): Promise<{ buffer: Buffer; mimeType: string } | null>;
}

interface Candidate {
  source: string;
  getUrl: () => Promise<string | null>;
}

/** Downloads whatever's at `url` and puts it through the exact same
 *  validate-then-re-encode pipeline gallery/service.ts's own uploadImage
 *  uses (real-format sniff via sharp reading actual bytes, not a
 *  claimed content-type; a dimension cap against decompression-bomb-
 *  style files; re-encode to a fixed WebP output, which as a side effect
 *  strips all metadata). Returns `null` on ANY failure — a 404, a
 *  timeout, a non-image response, a corrupt file — so callers can just
 *  move on to the next candidate rather than needing to distinguish why
 *  this one didn't work out. */
async function downloadAndReencode(url: string): Promise<{ data: Buffer; width: number; height: number } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());

    let metadata;
    try {
      metadata = await sharp(buffer).metadata();
    } catch {
      return null;
    }
    if (!metadata.width || !metadata.height || !metadata.format) return null;
    if (metadata.width > MAX_INPUT_DIMENSION || metadata.height > MAX_INPUT_DIMENSION) return null;

    const encoded = await sharp(buffer)
      .rotate()
      .resize({ width: OUTPUT_MAX_DIMENSION, height: OUTPUT_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: OUTPUT_QUALITY })
      .toBuffer({ resolveWithObject: true });

    return { data: encoded.data, width: encoded.info.width, height: encoded.info.height };
  } catch {
    return null;
  }
}

export function createCoversService(
  cacheRepo: CoverCacheRepository,
  blobStore: CoverBlobStore,
  hardcoverLookup: CoverLookupPort | null,
  publicUrlFor: (id: string) => string
): CoversService {
  return {
    async resolveCover({ isbn, imageId, title, author }) {
      // The ONLY two identifiers stable/global enough to trust as a
      // permanent, shared-across-every-account cache key — see
      // schema.sql's own comment for why a fuzzy title+author match
      // never gets one. isbn wins when both are present: it's the more
      // universal identifier (works across every source, not just
      // Kobo's own catalog), and matches the priority order the
      // frontend's own lib/covers.ts already established.
      const cacheKey = isbn ? `isbn:${isbn}` : imageId ? `kobo:${imageId}` : null;

      if (cacheKey) {
        const cached = await cacheRepo.getByCacheKey(cacheKey);
        if (cached) return { url: publicUrlFor(cached.id) };
      }

      // Same priority order the frontend's own resolveFallbackCover
      // chain uses — exact-identifier attempts (imageId/isbn-keyed)
      // before fuzzy title/author ones, Hardcover ahead of Google Books
      // among the ISBN-based attempts (Google's own unauthenticated
      // quota turned out to be the least reliable of the four sources —
      // see the Google adapter's own comment).
      const candidates: Candidate[] = [];
      if (imageId) candidates.push({ source: "kobo", getUrl: () => Promise.resolve(koboCoverUrl(imageId)) });
      if (isbn) candidates.push({ source: "openlibrary", getUrl: () => Promise.resolve(openLibraryCoverUrl(isbn)) });
      if (isbn && hardcoverLookup) candidates.push({ source: "hardcover", getUrl: () => hardcoverLookup.fetchCoverByIsbn(isbn) });
      if (isbn) candidates.push({ source: "google", getUrl: () => searchGoogleBooksCoverByIsbnUrl(isbn) });
      if (title) candidates.push({ source: "openlibrary", getUrl: () => searchOpenLibraryCoverUrl(title, author) });
      if (title) candidates.push({ source: "google", getUrl: () => searchGoogleBooksCoverUrl(title, author) });

      for (const candidate of candidates) {
        const url = await candidate.getUrl();
        if (!url) continue;

        // No stable cache key (title-only match, no isbn/imageId at
        // all) — nothing to persist this against, so there's no point
        // downloading bytes just to throw the cache-write half away;
        // hand back the source's own URL directly, same as this book
        // would have gotten before this cache existed.
        if (!cacheKey) return { url };

        const reencoded = await downloadAndReencode(url);
        if (!reencoded) continue; // this candidate's URL didn't actually pan out — try the next one

        const id = randomUUID();
        const row: CachedCoverRow = {
          id,
          cache_key: cacheKey,
          source: candidate.source,
          mime_type: OUTPUT_MIME_TYPE,
          extension: OUTPUT_EXTENSION,
          width: reencoded.width,
          height: reencoded.height,
          byte_size: reencoded.data.byteLength,
          created_at: new Date().toISOString()
        };
        await blobStore.save(id, OUTPUT_EXTENSION, reencoded.data);
        const wonRace = await cacheRepo.insert(row);
        // Lost a race to a concurrent request resolving this exact same
        // book (see the SQLite adapter's own comment) — the blob we just
        // saved under OUR OWN id is now a harmless orphan (no DB row
        // references it; no CoverBlobStore.delete exists to clean it up,
        // an accepted trade-off for how narrow and self-limiting this
        // window is — at most one small stray file per book, ever).
        // Every caller needs to converge on the SAME served URL
        // regardless of which concurrent request happened to finish
        // first, so read back whichever row actually won.
        const winningId = wonRace ? id : (await cacheRepo.getByCacheKey(cacheKey))!.id;
        return { url: publicUrlFor(winningId) };
      }

      return { url: null };
    },

    async getCachedCoverFile(id) {
      // No metadata lookup needed first (unlike gallery's getImageFile,
      // which reads the row for its user_id/extension) — every cached
      // cover here is written with the same fixed OUTPUT_EXTENSION/
      // OUTPUT_MIME_TYPE, so the file's own existence is the only real
      // question.
      const buffer = await blobStore.read(id, OUTPUT_EXTENSION);
      if (!buffer) return null;
      return { buffer, mimeType: OUTPUT_MIME_TYPE };
    }
  };
}
