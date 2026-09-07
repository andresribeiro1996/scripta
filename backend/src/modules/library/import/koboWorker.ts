import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";

const BOOK_COLUMNS = [
  "ContentID", "Title", "Attribution", "Series", "SeriesNumber", "ISBN", "Publisher", "Language",
  "___PercentRead", "ReadStatus", "DateLastRead", "DateCreated", "Rating", "TimeSpentReading",
  "WordCount", "MimeType", "ImageId"
];
const BOOKMARK_COLUMNS = [
  "BookmarkID", "VolumeID", "Text", "Annotation", "Type", "DateCreated", "DateModified", "ChapterProgress"
];

type Input = { path: string; maxRows: number; maxResultBytes: number; sqliteHeapBytes: number };

function fail(message: string): never {
  throw new Error(message);
}

function tableColumns(db: DatabaseSync, table: string): Set<string> {
  const row = db.prepare("SELECT type FROM sqlite_master WHERE name = ? COLLATE NOCASE").get(table) as { type?: string } | undefined;
  if (row?.type !== "table") fail(`\`${table}\` must be a real SQLite table.`);
  return new Set((db.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((column) => column.name));
}

function selected(wanted: string[], available: Set<string>): string[] {
  return wanted.filter((column) => available.has(column));
}

function quoted(columns: string[]): string {
  return columns.map((column) => `"${column}"`).join(", ");
}

function checkedRows(statement: ReturnType<DatabaseSync["prepare"]>, limit: number, byteState: { value: number }): Array<Record<string, unknown>> {
  const rows = statement.all(limit + 1) as Array<Record<string, unknown>>;
  if (rows.length > limit) fail("The SQLite import contains too many rows.");
  for (const row of rows) {
    byteState.value += Buffer.byteLength(JSON.stringify(row));
    if (byteState.value > (workerData as Input).maxResultBytes) fail("The SQLite import result is too large.");
  }
  return rows.map((row) => ({ ...row }));
}

function parse(): Record<string, unknown> {
  const input = workerData as Input;
  const db = new DatabaseSync(input.path, { readOnly: true });
  try {
    db.exec(`PRAGMA hard_heap_limit = ${input.sqliteHeapBytes}`);
    db.exec("PRAGMA query_only = ON");
    db.exec("PRAGMA trusted_schema = OFF");
    const contentColumns = tableColumns(db, "content");
    const bookmarkColumns = tableColumns(db, "Bookmark");
    const bookColumns = selected(BOOK_COLUMNS, contentColumns);
    const highlightColumns = selected(BOOKMARK_COLUMNS, bookmarkColumns);
    if (!contentColumns.has("ContentType") || !bookColumns.includes("ContentID")) {
      fail("`content` table has none of the required Kobo columns.");
    }

    const where = [`"ContentType" = '6'`];
    if (contentColumns.has("BookID")) where.push(`("BookID" IS NULL OR "BookID" = '')`);
    if (contentColumns.has("IsDownloaded")) where.push(`"IsDownloaded" = 'true'`);
    if (contentColumns.has("___FileSize")) where.push(`"___FileSize" > 0`);

    const bytes = { value: 0 };
    const books = checkedRows(
      db.prepare(`SELECT ${quoted(bookColumns)} FROM "content" WHERE ${where.join(" AND ")} LIMIT ?`),
      input.maxRows,
      bytes
    );
    const remaining = input.maxRows - books.length;
    let highlights: Array<Record<string, unknown>> = [];
    if (highlightColumns.includes("VolumeID")) {
      highlights = checkedRows(db.prepare(`SELECT ${quoted(highlightColumns)} FROM "Bookmark" LIMIT ?`), remaining, bytes);
    }

    const byVolume = new Map<string, Array<Record<string, unknown>>>();
    for (const highlight of highlights) {
      const volumeId = highlight.VolumeID;
      if (typeof volumeId !== "string" || !volumeId) continue;
      const entries = byVolume.get(volumeId) ?? [];
      entries.push(highlight);
      byVolume.set(volumeId, entries);
    }
    for (const book of books) {
      book.highlights = typeof book.ContentID === "string" ? (byVolume.get(book.ContentID) ?? []) : [];
    }

    const result = { source: "kobo-export", schema_version: 1, book_count: books.length, books };
    if (Buffer.byteLength(JSON.stringify(result)) > input.maxResultBytes) fail("The SQLite import result is too large.");
    return result;
  } finally {
    db.close();
  }
}

try {
  parentPort!.postMessage({ data: parse() });
} catch (error) {
  parentPort!.postMessage({ error: error instanceof Error ? error.message : "Couldn't parse the Kobo database." });
}
