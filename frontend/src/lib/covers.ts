// Identifier validation — used to build the query for the backend's
// cache-aware GET /covers/resolve (api/covers.ts) before ever reaching
// for an ISBN/ImageId that turns out to be junk, plus reused by
// lib/bookCovers.ts's own unrelated custom-cover-assignment bookkeeping.
//
// This file used to hold the ENTIRE cover-resolution chain directly —
// Kobo CDN, Open Library (ISBN-direct and fuzzy title+author search),
// Google Books, and Hardcover, tried in order, in the browser, on every
// single page load. Reported live as genuinely two problems ("i still
// miss a lot of bookcovers and its has low quality"), fixed in stages —
// bigger requested sizes, then Google Books as a second catalog, then
// Hardcover as a third — until it became clear the REAL fix for "why do
// I keep seeing the same slow/rate-limited lookups over and over" wasn't
// a fourth source, it was that nothing was ever being remembered: every
// browser tab, every page load, for every account, re-ran the whole
// chain from scratch for every book that didn't have a Kobo/Open-
// Library-ISBN hit. That whole chain — plus a persistent, GLOBAL cache
// (shared across every account, since the same public book has the same
// cover for everyone) of the actual downloaded/re-encoded image bytes,
// not just a remembered URL — now lives entirely in
// backend/src/modules/covers, checked BEFORE any external source is
// ever contacted. See that module's own service.ts for where the chain
// this file used to hold actually lives now, and its README section for
// the full reasoning.

export function normalizeIsbn(raw: unknown): string {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/[-\s]/g, "");
  return /^(?:\d{9}[\dXx]|\d{13})$/.test(cleaned) ? cleaned : "";
}

export function normalizeImageId(raw: unknown): string {
  const v = String(raw ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : "";
}

/** Plain text label for a book's ReadStatus (0/1/2) — BookCard shows this
 *  as a plain label rather than the colored dot+pill badge it used to. */
export function statusLabel(status: unknown): string {
  if (status === 2) return "Finished";
  if (status === 1) return "Reading";
  return "Not read";
}
