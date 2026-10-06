// Format detection + dispatch for an imported library file — mirrors
// viewer/index.html's readFile()/handleTextBytes() for the Kobo/Goodreads
// paths (StoryGraph is a frontend-only addition, see fileImport's README
// note): sniff the file's magic bytes (never trust the filename/
// extension), then within text content try JSON first (unambiguous —
// valid JSON with a "books" array can't also be a CSV), then each known
// CSV shape by its own distinct header columns.

import type { LibraryData } from "../api/library";
import { bookCsvToLibraryJson, decodeLibraryImport } from "@scripta/shared";
import { goodreadsCsvToLibraryJson, looksLikeGoodreadsCsv } from "./goodreads";
import { isSqliteBytes, parseSqliteFile } from "./sqlite";
import { looksLikeStorygraphCsv, storygraphCsvToLibraryJson } from "./storygraph";

export async function parseImportedFile(file: File): Promise<LibraryData> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (isSqliteBytes(bytes)) {
    return parseSqliteFile(bytes);
  }

  const text = decodeLibraryImport(bytes);

  const parsedJson = tryParseJson(text);
  if (parsedJson) {
    if (!Array.isArray((parsedJson as { books?: unknown }).books)) {
      throw new Error('That JSON doesn\'t look like a kobo-export library file (missing a "books" array).');
    }
    return parsedJson as LibraryData;
  }

  if (looksLikeGoodreadsCsv(text)) {
    return goodreadsCsvToLibraryJson(text);
  }

  if (looksLikeStorygraphCsv(text)) {
    return storygraphCsvToLibraryJson(text);
  }

  const books = bookCsvToLibraryJson(text);
  if (books) return books;

  throw new Error(
    "Didn't recognize that file — choose Kobo SQLite, library JSON, Goodreads, StoryGraph, Calibre, LibraryThing TSV, BookWyrm CSV, or a book CSV with Title and Author columns."
  );
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
