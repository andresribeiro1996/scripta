// KoboReader.sqlite -> library JSON, a direct port of the same logic
// proven out in viewer/index.html and exporter/export.py — kept in sync
// with both rather than shared, since the viewer is being retired.
//
// Unlike the standalone viewer (opened via a plain file:// double-click,
// where sql.js's WASM had to be inlined as base64 to dodge Chrome's
// fetch-of-local-files restriction), this is a real bundled app served
// over http — so the plain npm `sql.js` package + Vite's asset pipeline
// for the .wasm file is the more idiomatic fit here, no inlining needed.

import initSqlJs, { type Database } from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import type { LibraryData } from "../api/library";

// Mirrors exporter/export.py's BOOK_COLUMNS / BOOKMARK_COLUMNS.
const BOOK_COLUMNS = [
  "ContentID", "Title", "Attribution", "Series", "SeriesNumber", "ISBN",
  "Publisher", "Language", "___PercentRead", "ReadStatus", "DateLastRead",
  "DateCreated", "Rating", "TimeSpentReading", "WordCount", "MimeType", "ImageId"
];
const BOOKMARK_COLUMNS = [
  "BookmarkID", "VolumeID", "Text", "Annotation", "Type",
  "DateCreated", "DateModified", "ChapterProgress"
];

// The SQLite file header is "SQLite format 3" followed by a NUL
// terminator byte (16 bytes total). See viewer/index.html's identical
// check for why the NUL is compared as a byte value rather than embedded
// in the string literal (an HTML-parsing quirk that doesn't apply to a
// .ts file, but there's no reason for the logic to differ from the
// proven version).
const SQLITE_MAGIC = "SQLite format 3";

export function isSqliteBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  for (let i = 0; i < SQLITE_MAGIC.length; i++) {
    if (bytes[i] !== SQLITE_MAGIC.charCodeAt(i)) return false;
  }
  return bytes[15] === 0;
}

let sqlJsPromise: Promise<Awaited<ReturnType<typeof initSqlJs>>> | null = null;
function getSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({ locateFile: () => sqlWasmUrl });
  }
  return sqlJsPromise;
}

function tableColumns(db: Database, table: string): string[] {
  const res = db.exec(`PRAGMA table_info(${table})`);
  if (!res.length) return [];
  const nameIdx = res[0].columns.indexOf("name");
  return res[0].values.map((row) => String(row[nameIdx]));
}

function runQuery(db: Database, sql: string): Array<Record<string, unknown>> {
  const res = db.exec(sql);
  if (!res.length) return [];
  const cols = res[0].columns;
  return res[0].values.map((row) => {
    const obj: Record<string, unknown> = {};
    cols.forEach((c, i) => {
      obj[c] = row[i];
    });
    return obj;
  });
}

function sqliteToLibraryJson(db: Database): LibraryData {
  const haveContentCols = tableColumns(db, "content");
  const bookCols = BOOK_COLUMNS.filter((c) => haveContentCols.includes(c));
  if (!bookCols.length) {
    throw new Error("`content` table has none of the expected columns — unexpected schema.");
  }
  const haveBookmarkCols = tableColumns(db, "Bookmark");
  const bookmarkCols = BOOKMARK_COLUMNS.filter((c) => haveBookmarkCols.includes(c));

  // ContentType 6 alone isn't enough: Kobo's Nickel software also caches
  // store/recommendation catalog entries into this same table for offline
  // browsing — books you've merely seen, not ones you own or have on the
  // device. Those show up with IsDownloaded='false' and ___FileSize=0.
  const filterCols = ["IsDownloaded", "___FileSize"].filter((c) => haveContentCols.includes(c));
  let extraWhere = "";
  if (filterCols.includes("IsDownloaded")) extraWhere += " AND IsDownloaded = 'true'";
  if (filterCols.includes("___FileSize")) extraWhere += " AND ___FileSize > 0";

  const books = runQuery(
    db,
    `SELECT ${bookCols.join(", ")} FROM content WHERE ContentType = '6' AND (BookID IS NULL OR BookID = '')${extraWhere}`
  );

  const highlightsByVolume: Record<string, Array<Record<string, unknown>>> = {};
  if (bookmarkCols.length && bookmarkCols.includes("VolumeID")) {
    const bookmarks = runQuery(db, `SELECT ${bookmarkCols.join(", ")} FROM Bookmark`);
    for (const b of bookmarks) {
      const vol = b.VolumeID as string | undefined;
      if (!vol) continue;
      (highlightsByVolume[vol] ??= []).push(b);
    }
  }

  for (const b of books) {
    b.highlights = highlightsByVolume[b.ContentID as string] ?? [];
  }

  return {
    source: "kobo-export (browser)",
    schema_version: 1,
    book_count: books.length,
    books
  };
}

export async function parseSqliteFile(bytes: Uint8Array): Promise<LibraryData> {
  const SQL = await getSqlJs();
  const db = new SQL.Database(bytes);
  try {
    return sqliteToLibraryJson(db);
  } finally {
    db.close();
  }
}
