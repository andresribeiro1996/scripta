import { readFile, open } from "node:fs/promises";
import { Worker } from "node:worker_threads";
import {
  goodreadsCsvToLibraryJson,
  looksLikeGoodreadsCsv,
  looksLikeStorygraphCsv,
  storygraphCsvToLibraryJson,
  type LibraryData
} from "@scripta/shared";

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0");
const MAX_SQLITE_ROWS = 100_000;
const WORKER_MEMORY_MB = 64;

export class InvalidImportError extends Error {}
export class ImportTimeoutError extends InvalidImportError {}

export interface ImportPreview {
  data: LibraryData;
  warnings: string[];
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

function parseKobo(path: string, timeoutMs: number, maxResultBytes: number): Promise<LibraryData> {
  return new Promise((resolve, reject) => {
    const sourceUrl = new URL(import.meta.url.endsWith(".ts") ? "./koboWorker.ts" : "./koboWorker.js", import.meta.url);
    const worker = new Worker(sourceUrl, {
      workerData: { path, maxRows: MAX_SQLITE_ROWS, maxResultBytes, sqliteHeapBytes: WORKER_MEMORY_MB * 1024 * 1024 },
      resourceLimits: { maxOldGenerationSizeMb: WORKER_MEMORY_MB, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 }
    });
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => {
      void worker.terminate();
      finish(() => reject(new ImportTimeoutError("The Kobo database took too long to parse.")));
    }, timeoutMs);
    worker.once("message", (message: { data?: LibraryData; error?: string }) => {
      void worker.terminate();
      finish(() => message.data ? resolve(message.data) : reject(new InvalidImportError(message.error ?? "Couldn't parse the Kobo database.")));
    });
    worker.once("error", (error) => finish(() => reject(new InvalidImportError(error.message))));
    worker.once("exit", (code) => {
      if (code !== 0) finish(() => reject(new InvalidImportError("The Kobo parser worker stopped before completing.")));
    });
  });
}

export async function parseImport(path: string, timeoutMs: number, maxResultBytes: number): Promise<ImportPreview> {
  if (await isSqlite(path)) return { data: await parseKobo(path, timeoutMs, maxResultBytes), warnings: [] };

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path));
  } catch {
    throw new InvalidImportError("Couldn't decode that file as text, and it isn't a SQLite database.");
  }

  try {
    const json: unknown = JSON.parse(text);
    if (!isLibraryData(json)) throw new InvalidImportError('That JSON is missing a "books" array.');
    return { data: json, warnings: [] };
  } catch (error) {
    if (error instanceof InvalidImportError) throw error;
  }

  try {
    if (looksLikeGoodreadsCsv(text)) return { data: goodreadsCsvToLibraryJson(text), warnings: [] };
    if (looksLikeStorygraphCsv(text)) return { data: storygraphCsvToLibraryJson(text), warnings: [] };
  } catch (error) {
    throw new InvalidImportError(error instanceof Error ? error.message : "Couldn't parse that CSV export.");
  }
  throw new InvalidImportError("Didn't recognize that file as Kobo SQLite, library JSON, Goodreads CSV, or StoryGraph CSV.");
}
