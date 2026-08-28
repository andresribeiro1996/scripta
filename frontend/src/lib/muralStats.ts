// Pure computation for the `stats` mural block (lib/murals.ts) — every
// number here is derived live from the current library, never stored or
// curated, so a stats block always reflects reality with zero upkeep.
//
// Every metric guards against fields a book might not actually have —
// ReadStatus/DateLastRead/highlights all come from either the Kobo
// exporter or the Goodreads CSV importer (lib/goodreads.ts), and both
// populate them, but neither is guaranteed present on every book (a
// hand-merged/edited library, an older export, etc.).

import type { StatMetric } from "./murals";

function isFinished(book: Record<string, unknown>): boolean {
  return book.ReadStatus === 2;
}

function isInProgress(book: Record<string, unknown>): boolean {
  return book.ReadStatus === 1;
}

function finishedInYear(book: Record<string, unknown>, year: number): boolean {
  if (!isFinished(book)) return false;
  const raw = book.DateLastRead;
  if (typeof raw !== "string" || !raw) return false;
  const parsed = new Date(raw);
  return !Number.isNaN(parsed.getTime()) && parsed.getFullYear() === year;
}

function highlightCount(book: Record<string, unknown>): number {
  return Array.isArray(book.highlights) ? book.highlights.length : 0;
}

/** `now` is injectable so "this year" is testable without depending on
 *  the real clock — defaults to the actual current time for real
 *  rendering (StatsBlock.tsx calls this with no second argument). */
export function computeStat(metric: StatMetric, books: Array<Record<string, unknown>>, now: Date = new Date()): number {
  switch (metric) {
    case "totalBooks":
      return books.length;
    case "booksFinished":
      return books.filter(isFinished).length;
    case "booksFinishedThisYear":
      return books.filter((b) => finishedInYear(b, now.getFullYear())).length;
    case "booksInProgress":
      return books.filter(isInProgress).length;
    case "totalHighlights":
      return books.reduce((sum, b) => sum + highlightCount(b), 0);
  }
}
