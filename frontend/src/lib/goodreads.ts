// Goodreads CSV -> library JSON, a direct port of the same logic in
// viewer/index.html.
//
// Get this file from goodreads.com: My Books -> Tools (left sidebar) ->
// Import/Export -> Export Library. No API key, no scraping — Goodreads
// emails/generates a download link for a CSV of your whole library.
//
// Mapped onto the same book shape the Kobo paths produce, so it renders
// in the same grid: title/author/ISBN/rating carry over directly,
// "Exclusive Shelf" becomes ReadStatus, and a non-empty "My Review" is
// surfaced as a single highlight-like entry (Goodreads has no per-passage
// highlights the way Kobo does). There's no cover-lookup key equivalent
// to Kobo's ImageId, so cover art for Goodreads-sourced books relies on
// the ISBN and title+author search tiers only.
//
// Known limitation: Goodreads' standard export has no dedicated series
// column — series info is sometimes embedded in the title text itself
// (e.g. "Book Title (Series, #2)") but isn't parsed out here.

import type { LibraryData } from "../api/library";
import { csvRowsToObjects, parseCsv } from "./csv";

export function looksLikeGoodreadsCsv(text: string): boolean {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  return (
    firstLine.includes("Book Id") &&
    firstLine.includes("Title") &&
    firstLine.includes("Author") &&
    firstLine.includes("Exclusive Shelf")
  );
}

// Goodreads wraps ISBN/ISBN13 fields as ="1234567890" to stop spreadsheet
// apps from mangling them (dropping leading zeros, scientific notation).
function stripGoodreadsIsbnWrapper(raw: string | undefined): string {
  const v = (raw ?? "").trim();
  const m = /^="?([^"]*)"?$/.exec(v);
  return m ? m[1].trim() : v;
}

function goodreadsShelfToStatus(shelf: string | undefined): number {
  const s = (shelf ?? "").trim().toLowerCase();
  if (s === "read") return 2;
  if (s === "currently-reading") return 1;
  return 0; // "to-read", or any custom shelf
}

export function goodreadsCsvToLibraryJson(text: string): LibraryData {
  const rows = csvRowsToObjects(parseCsv(text));
  if (!rows.length) {
    throw new Error("That Goodreads CSV doesn't have any books in it.");
  }

  const books = rows.map((row, i) => {
    const isbn13 = stripGoodreadsIsbnWrapper(row["ISBN13"]);
    const isbn10 = stripGoodreadsIsbnWrapper(row["ISBN"]);
    const status = goodreadsShelfToStatus(row["Exclusive Shelf"]);
    const rating = parseInt(row["My Rating"], 10);
    const review = (row["My Review"] ?? "").trim();
    const contentId = `goodreads:${row["Book Id"] || i}`;

    const book: Record<string, unknown> = {
      ContentID: contentId,
      Title: row["Title"] || "",
      Attribution: row["Author"] || "",
      Series: null,
      SeriesNumber: null,
      ISBN: isbn13 || isbn10 || "",
      Publisher: row["Publisher"] || null,
      Language: null,
      ___PercentRead: status === 2 ? 100 : 0,
      ReadStatus: status,
      DateLastRead: row["Date Read"] || null,
      DateCreated: row["Date Added"] || null,
      Rating: rating > 0 ? rating : null,
      TimeSpentReading: null,
      WordCount: -1,
      MimeType: null,
      ImageId: null,
      highlights: [] as Array<Record<string, unknown>>
    };

    if (review) {
      (book.highlights as Array<Record<string, unknown>>).push({
        BookmarkID: `goodreads-review:${contentId}`,
        VolumeID: contentId,
        Text: review,
        Annotation: "",
        Type: "review",
        DateCreated: row["Date Read"] || row["Date Added"] || null,
        DateModified: null,
        ChapterProgress: null
      });
    }

    return book;
  });

  return {
    source: "goodreads-export (browser)",
    schema_version: 1,
    book_count: books.length,
    books
  };
}
