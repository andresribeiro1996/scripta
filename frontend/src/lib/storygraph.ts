// StoryGraph CSV -> library JSON, sibling of lib/goodreads.ts (same
// dispatch point: lib/fileImport.ts).
//
// Get this file from thestorygraph.com: click your profile icon (top
// right) -> "Manage Your Account" -> "Manage Your Data" tab -> "Export
// StoryGraph Library" (or "Export StoryGraph Data" — the plain library
// export is the one this expects). No API key, no scraping — StoryGraph
// emails a download link for a CSV of your whole library.
//
// Mapped onto the same book shape the Kobo/Goodreads paths produce, so it
// renders in the same grid: title/authors/rating carry over directly,
// "Read Status" becomes ReadStatus, and a non-empty "Review" is surfaced
// as a single highlight-like entry, same as Goodreads' "My Review".
//
// Known limitations, mirroring Goodreads' own:
// - No per-passage highlights (StoryGraph doesn't have that concept
//   either) — just the one review-as-highlight.
// - No dedicated series column — series info, if present at all, is
//   embedded in the title text itself and isn't parsed out.
// - "ISBN/UID" is StoryGraph's own column name because it isn't always an
//   ISBN — for books StoryGraph doesn't have an ISBN on file, it's an
//   internal slug/UID instead. Only kept as this book's ISBN when it's
//   actually ISBN-10/13-shaped (see normalizeIsbn); the raw value is used
//   for ContentID regardless, since it's still a stable per-book key
//   either way.
// - "Contributors" (e.g. an audiobook narrator), "Format", "Moods",
//   "Pace", the mood-tag questions ("Loveable Characters?" etc.), "Tags",
//   and "Owned?" have no equivalent in this app's book shape and aren't
//   imported.

import type { LibraryData } from "../api/library";
import { normalizeIsbn } from "./covers";
import { csvRowsToObjects, parseCsv } from "./csv";

export function looksLikeStorygraphCsv(text: string): boolean {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  return (
    firstLine.includes("Title") &&
    firstLine.includes("Authors") &&
    firstLine.includes("Read Status") &&
    firstLine.includes("ISBN/UID")
  );
}

function storygraphStatusToReadStatus(status: string | undefined): number {
  const s = (status ?? "").trim().toLowerCase();
  if (s === "read") return 2;
  if (s === "currently-reading") return 1;
  return 0; // "to-read", "did-not-finish", or anything else
}

export function storygraphCsvToLibraryJson(text: string): LibraryData {
  const rows = csvRowsToObjects(parseCsv(text));
  if (!rows.length) {
    throw new Error("That StoryGraph CSV doesn't have any books in it.");
  }

  const books = rows.map((row, i) => {
    const isbnOrUid = (row["ISBN/UID"] ?? "").trim();
    const status = storygraphStatusToReadStatus(row["Read Status"]);
    const rating = parseFloat(row["Star Rating"]);
    const review = (row["Review"] ?? "").trim();
    const contentId = `storygraph:${isbnOrUid || i}`;
    const lastRead = row["Last Date Read"] || null;

    const book: Record<string, unknown> = {
      ContentID: contentId,
      Title: row["Title"] || "",
      Attribution: row["Authors"] || "",
      Series: null,
      SeriesNumber: null,
      ISBN: normalizeIsbn(isbnOrUid),
      Publisher: null,
      Language: null,
      ___PercentRead: status === 2 ? 100 : 0,
      ReadStatus: status,
      DateLastRead: lastRead,
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
        BookmarkID: `storygraph-review:${contentId}`,
        VolumeID: contentId,
        Text: review,
        Annotation: "",
        Type: "review",
        DateCreated: lastRead || row["Date Added"] || null,
        DateModified: null,
        ChapterProgress: null
      });
    }

    return book;
  });

  return {
    source: "storygraph-export (browser)",
    schema_version: 1,
    book_count: books.length,
    books
  };
}
