import { normalizeIsbn } from "./covers.js";
import { normalizeBookGenres } from "./bookGenres.js";
import { parseCsv } from "./csv.js";
import type { LibraryData } from "./types.js";

export const LIBRARY_CSV_TEMPLATE = "Title,Author,ISBN,Status,Rating,Date Read,Date Added,Series,Series Number,Publisher,Language,Tags\r\n";

export const BOOK_CSV_ERRORS = [
  "That CSV has invalid quoting.",
  "That book CSV doesn't have any books in it.",
  "That book CSV has duplicate column names.",
  "Each CSV row must have the same number of fields as the header.",
  "Each CSV book needs a title and author.",
  "CSV ISBNs must be ISBN-10 or ISBN-13, stored as text.",
  "CSV statuses must be to-read, reading, or read.",
  "CSV ratings must be numbers from 0 to 5.",
  "CSV series numbers must be non-negative numbers.",
  "CSV dates must be valid YYYY-MM-DD dates."
] as const;

function columnName(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, " ");
}

export function looksLikeLibrarythingTsv(text: string): boolean {
  const header = (text.split(/\r?\n/, 1)[0] ?? "").split("\t").map(columnName);
  return ["book id", "title", "primary author"].every((name) => header.includes(name));
}

export function decodeLibraryImport(bytes: Uint8Array): string {
  if (bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191) bytes = bytes.subarray(3);
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  try {
    return utf8.decode(bytes);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    const legacy = new TextDecoder("windows-1252");
    const newline = bytes.indexOf(10);
    if (!looksLikeLibrarythingTsv(legacy.decode(bytes.subarray(0, newline < 0 ? bytes.length : newline)))) {
      throw new Error("Couldn't decode that file as text, and it isn't a SQLite database.");
    }
    let text = "";
    let start = 0;
    for (let i = 0; i <= bytes.length; i++) {
      if (i !== bytes.length && bytes[i] !== 9 && bytes[i] !== 10 && bytes[i] !== 13) continue;
      const field = bytes.subarray(start, i);
      try {
        text += utf8.decode(field);
      } catch (cause) {
        if (!(cause instanceof TypeError)) throw cause;
        text += legacy.decode(field);
      }
      if (i < bytes.length) text += String.fromCharCode(bytes[i]);
      start = i + 1;
    }
    return text;
  }
}

export function bookCsvToLibraryJson(text: string): LibraryData | null {
  const librarything = looksLikeLibrarythingTsv(text);
  const [rawHeader, ...rawRows] = parseCsv(text, librarything ? "\t" : ",");
  if (!rawHeader) return null;
  const header = rawHeader.map(columnName);
  const bookwyrm = ["title", "author text", "remote id", "shelf"].every((name) => header.includes(name));
  if (!librarything && !bookwyrm && (!header.includes("title") || !(header.includes("author") || header.includes("authors")))) return null;
  if (new Set(header).size !== header.length) throw new Error(BOOK_CSV_ERRORS[2]);
  const calibre = header.includes("authors") && ["id", "uuid", "library name", "series index", "timestamp", "formats"].some((name) => header.includes(name));
  const rows = rawRows.filter((row) => row.some((value) => value.trim()));
  if (!rows.length) throw new Error(BOOK_CSV_ERRORS[1]);

  const books = rows.map((values) => {
    if (values.length !== header.length) throw new Error(BOOK_CSV_ERRORS[3]);
    const row = Object.fromEntries(header.map((name, i) => [name, values[i].trim()]));
    if (librarything) {
      row.author = row["primary author"];
      row.isbn = (row.isbn || "").replace(/^\[|\]$/g, "");
      if (!row.isbn && row.isbns) {
        const isbns = row.isbns.split(/[,|]/).map((value) => normalizeIsbn(value.replace(/\[|\]/g, "")));
        row.isbn = isbns.find((value) => value.length === 13) || isbns.find(Boolean) || "";
        if (!row.isbn) throw new Error(BOOK_CSV_ERRORS[5]);
      }
      row["date read"] = (row["date read"] || "").replace(/^\[|\]$/g, "");
      row["date started"] = (row["date started"] || "").replace(/^\[|\]$/g, "");
      row["date added"] = (row["entry date"] || "").replace(/^\[|\]$/g, "");
      const collections = (row.collections || "").toLowerCase().split(/[,|]/).map((value) => value.trim());
      if (row["date read"]) row.status = "read";
      else if (row["date started"] || collections.includes("currently reading")) row.status = "reading";
      else if (collections.includes("read but unowned")) row.status = "read";
      else if (collections.includes("to read") || collections.includes("wishlist")) row.status = "to-read";
    }
    if (bookwyrm) {
      row.author = row["author text"];
      row.isbn13 = row["isbn 13"] || "";
      row.isbn = row["isbn 10"] || "";
      row["date read"] = row["finish date"] || "";
      row["date started"] = row["start date"] || "";
      row["date stopped"] = row["stopped date"] || "";
      row.review = row["review content"] || "";
      row.status = ["to-read", "reading", "read"].includes(row.shelf) ? row.shelf : row["date read"] ? "read" : row["date started"] && !row["date stopped"] ? "reading" : "";
    }
    const title = row.title;
    const author = row.author || row.authors || "";
    if (!title || (!author && !librarything && !bookwyrm)) throw new Error(BOOK_CSV_ERRORS[4]);
    const rawIsbn = (row.isbn13 || row.isbn || "").replace(/^="?([^"]*)"?$/, "$1");
    const isbn = normalizeIsbn(rawIsbn);
    if (rawIsbn && !isbn) throw new Error(BOOK_CSV_ERRORS[5]);
    const source = librarything ? "librarything" : bookwyrm ? "bookwyrm" : calibre ? "calibre" : "csv";
    const book: Record<string, unknown> = {
      ContentID: `${source}:${(librarything && row["book id"]) || (bookwyrm && row["remote id"]) || isbn || JSON.stringify([title, author])}`,
      Title: title,
      Attribution: author,
      highlights: []
    };
    if (isbn) book.ISBN = isbn;
    const status = row.status || row["read status"];
    if (status) {
      const statuses: Record<string, number> = { "to-read": 0, unread: 0, reading: 1, "currently-reading": 1, read: 2, finished: 2 };
      const key = status.toLowerCase();
      if (!Object.hasOwn(statuses, key)) throw new Error(BOOK_CSV_ERRORS[6]);
      const readStatus = statuses[key];
      book.ReadStatus = readStatus;
      if (readStatus === 2) book.___PercentRead = 100;
    }
    if (row.rating) {
      const rating = Number(row.rating);
      if (!Number.isFinite(rating) || rating < 0 || rating > 5) throw new Error(BOOK_CSV_ERRORS[7]);
      book.Rating = rating || null;
    }
    const seriesNumber = row["series number"] || row["series index"];
    if (seriesNumber) {
      const number = Number(seriesNumber);
      if (!Number.isFinite(number) || number < 0) throw new Error(BOOK_CSV_ERRORS[8]);
      book.SeriesNumber = number;
    }
    for (const [column, field] of [["series", "Series"], ["publisher", "Publisher"], ["language", "Language"]]) {
      if (row[column]) book[field] = row[column];
    }
    if (row.languages) book.Language = calibre ? row.languages.replace(/^\[|\]$/g, "").replace(/'/g, "") : row.languages;
    for (const [column, field] of [["date read", "DateLastRead"], ["date added", "DateCreated"], ...(librarything || bookwyrm ? [["date started", "DateStarted"]] : []), ...(bookwyrm ? [["date stopped", "DateStopped"], ["review published", "DateReviewPublished"]] : [])]) {
      const date = row[column];
      if (!date) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
        throw new Error(BOOK_CSV_ERRORS[9]);
      }
      book[field] = date;
    }
    if (calibre && row.timestamp) {
      if (!Number.isFinite(Date.parse(row.timestamp))) throw new Error(BOOK_CSV_ERRORS[9]);
      book.DateCreated = row.timestamp;
    }
    const genres = normalizeBookGenres(row.tags);
    if (genres.length) book._genres = genres;
    if ((librarything || bookwyrm) && row.review) {
      book.highlights = [{ BookmarkID: `${source}-review:${book.ContentID}`, VolumeID: book.ContentID, Text: row.review, Annotation: "", Type: "review", DateCreated: book.DateReviewPublished || book.DateLastRead || book.DateCreated || null }];
    }
    return book;
  });
  return { source: librarything ? "librarything-export" : bookwyrm ? "bookwyrm-export" : calibre ? "calibre-export" : "spreadsheet-export", schema_version: 1, book_count: books.length, books };
}
