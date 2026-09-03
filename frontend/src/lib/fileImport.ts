// Format detection + dispatch for an imported library file — mirrors
// viewer/index.html's readFile()/handleTextBytes() for the Kobo/Goodreads
// paths (StoryGraph is a frontend-only addition, see fileImport's README
// note): sniff the file's magic bytes (never trust the filename/
// extension), then within text content try JSON first (unambiguous —
// valid JSON with a "books" array can't also be a CSV), then each known
// CSV shape by its own distinct header columns.

import type { LibraryData } from "../api/library";
import { goodreadsCsvToLibraryJson, looksLikeGoodreadsCsv } from "./goodreads";
import { isSqliteBytes, parseSqliteFile } from "./sqlite";
import { looksLikeStorygraphCsv, storygraphCsvToLibraryJson } from "./storygraph";

export async function parseImportedFile(file: File): Promise<LibraryData> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (isSqliteBytes(bytes)) {
    return parseSqliteFile(bytes);
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8").decode(bytes);
  } catch {
    throw new Error("Couldn't decode that file as text, and it's not a SQLite database.");
  }

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

  throw new Error(
    "Didn't recognize that file — it's not a KoboReader.sqlite database, a kobo-export library JSON, a Goodreads library CSV export, or a StoryGraph library CSV export."
  );
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
