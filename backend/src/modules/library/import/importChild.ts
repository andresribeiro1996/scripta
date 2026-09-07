import { open, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import {
  goodreadsCsvToLibraryJson,
  looksLikeGoodreadsCsv,
  looksLikeStorygraphCsv,
  storygraphCsvToLibraryJson,
  type LibraryData
} from "@scripta/shared";

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0");
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

function isLibraryData(value: unknown): value is LibraryData {
  return typeof value === "object" && value !== null && Array.isArray((value as { books?: unknown }).books);
}

async function isSqlite(path: string): Promise<boolean> {
  const file = await open(path, "r");
  try {
    const header = Buffer.alloc(SQLITE_MAGIC.length);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    return bytesRead === header.length && header.equals(SQLITE_MAGIC);
  } finally {
    await file.close();
  }
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

function checkedRows(statement: ReturnType<DatabaseSync["prepare"]>, limit: number, byteState: { value: number }, maxResultBytes: number): Array<Record<string, unknown>> {
  const rows = statement.all(limit + 1) as Array<Record<string, unknown>>;
  if (rows.length > limit) fail("The import contains too many rows.");
  for (const row of rows) {
    byteState.value += Buffer.byteLength(JSON.stringify(row));
    if (byteState.value > maxResultBytes) fail("The import result is too large.");
  }
  return rows.map((row) => ({ ...row }));
}

function parseKobo(input: Input): LibraryData {
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
      bytes,
      input.maxResultBytes
    );
    const remaining = input.maxRows - books.length;
    let highlights: Array<Record<string, unknown>> = [];
    if (highlightColumns.includes("VolumeID")) {
      highlights = checkedRows(db.prepare(`SELECT ${quoted(highlightColumns)} FROM "Bookmark" LIMIT ?`), remaining, bytes, input.maxResultBytes);
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

    return { source: "kobo-export", schema_version: 1, book_count: books.length, books };
  } finally {
    db.close();
  }
}

async function parseText(input: Input): Promise<LibraryData> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(input.path));
  } catch {
    fail("Couldn't decode that file as text, and it isn't a SQLite database.");
  }

  try {
    const json: unknown = JSON.parse(text);
    if (!isLibraryData(json)) fail('That JSON is missing a "books" array.');
    return json;
  } catch (error) {
    if (error instanceof Error && error.message === 'That JSON is missing a "books" array.') throw error;
  }

  try {
    if (looksLikeGoodreadsCsv(text)) return goodreadsCsvToLibraryJson(text);
    if (looksLikeStorygraphCsv(text)) return storygraphCsvToLibraryJson(text);
  } catch (error) {
    fail(error instanceof Error ? error.message : "Couldn't parse that CSV export.");
  }
  fail("Didn't recognize that file as Kobo SQLite, library JSON, Goodreads CSV, or StoryGraph CSV.");
}

async function parse(input: Input): Promise<LibraryData> {
  const [, , , , testFlag, testDelay] = process.argv.slice(2);
  const delayMs = testFlag === "--test-delay" ? Number(testDelay) : 0;
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  const data = await isSqlite(input.path) ? parseKobo(input) : await parseText(input);
  if (data.books.length > input.maxRows) fail("The import contains too many rows.");
  if (Buffer.byteLength(JSON.stringify(data)) > input.maxResultBytes) fail("The import result is too large.");
  return data;
}

const [path, maxRows, maxResultBytes, sqliteHeapBytes] = process.argv.slice(2);
if (!path || !maxRows || !maxResultBytes || !sqliteHeapBytes) process.exit(1);

try {
  process.send!({ data: await parse({ path, maxRows: Number(maxRows), maxResultBytes: Number(maxResultBytes), sqliteHeapBytes: Number(sqliteHeapBytes) }) });
} catch (error) {
  process.send!({ error: error instanceof Error ? error.message : "Couldn't parse that import file." });
}
