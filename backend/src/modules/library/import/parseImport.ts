import type { LibraryData } from "@scripta/shared";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const MAX_IMPORT_ROWS = 100_000;
const CHILD_MEMORY_MB = 64;
const MAX_PARALLEL_IMPORTS = 2;

export class InvalidImportError extends Error {}
export class ImportTimeoutError extends InvalidImportError {}
export class ImportBusyError extends Error {}

export interface ImportPreview {
  data: LibraryData;
  warnings: string[];
}

const SAFE_IMPORT_ERRORS = new Set([
  "The import contains too many rows.",
  "The import result is too large.",
  "`content` table has none of the required Kobo columns.",
  "Couldn't decode that file as text, and it isn't a SQLite database.",
  'That JSON is missing a "books" array.',
  "Didn't recognize that file as Kobo SQLite, library JSON, Goodreads CSV, or StoryGraph CSV.",
  "Couldn't parse that CSV export.",
  "That Goodreads CSV doesn't have any books in it.",
  "That StoryGraph CSV doesn't have any books in it.",
  "The import file took too long to parse.",
  "The import parser stopped before completing."
]);

const SAFE_TABLE_ERROR = /^`(content|Bookmark)` must be a real SQLite table\.$/;

export function sanitizeImportError(raw: string | undefined): string {
  if (!raw) return "Couldn't parse that import file.";
  if (SAFE_IMPORT_ERRORS.has(raw)) return raw;
  if (SAFE_TABLE_ERROR.test(raw)) return raw;
  return "Couldn't parse that import file.";
}

let inFlight = 0;

type ImportLogger = { warn(...args: unknown[]): void };

export function parseImport(path: string, timeoutMs: number, maxResultBytes: number, logger: ImportLogger = console): Promise<ImportPreview> {
  if (inFlight >= MAX_PARALLEL_IMPORTS) {
    return Promise.reject(new ImportBusyError("Import parser is busy — try again in a moment."));
  }
  inFlight++;
  return new Promise((resolve, reject) => {
    const sourceUrl = new URL(import.meta.url.endsWith(".ts") ? "./importChild.ts" : "./importChild.js", import.meta.url);
    const childArgs = [
      ...process.execArgv,
      `--max-old-space-size=${CHILD_MEMORY_MB}`,
      fileURLToPath(sourceUrl),
      path,
      String(MAX_IMPORT_ROWS),
      String(maxResultBytes),
      String(CHILD_MEMORY_MB * 1024 * 1024)
    ];
    if (process.env.NODE_ENV === "test" && process.env.IMPORT_PARSE_TEST_DELAY_MS) {
      childArgs.push("--test-delay", process.env.IMPORT_PARSE_TEST_DELAY_MS);
    }
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("/bin/sh", ["-c", 'ulimit -t "$1"; shift; exec "$@"', "scripta-import", String(Math.max(1, Math.ceil(timeoutMs / 1000) * 2)), process.execPath, ...childArgs], {
        env: {
          ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
          ...(process.env.NODE_ENV ? { NODE_ENV: process.env.NODE_ENV } : {})
        },
        stdio: ["ignore", "ignore", "ignore", "ipc"]
      });
    } catch (error) {
      inFlight--;
      logger.warn({ err: error }, "import parser child failed to spawn");
      throw error;
    }
    let settled = false;
    let timedOut = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      inFlight--;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.once("message", (message: { data?: LibraryData; error?: string }) => {
      if (timedOut) return;
      finish(() => message.data
        ? resolve({ data: message.data, warnings: [] })
        : reject(new InvalidImportError(sanitizeImportError(message.error))));
    });
    child.once("error", (error) => {
      if (!settled) logger.warn({ err: error }, "import parser child failed to spawn");
      if (!timedOut) finish(() => reject(new InvalidImportError("Couldn't parse that import file.")));
    });
    child.once("exit", (code, signal) => {
      if (!settled) logger.warn({ code, signal }, "import parser child exited before sending a result");
      if (timedOut && signal === "SIGKILL") {
        finish(() => reject(new ImportTimeoutError("The import file took too long to parse.")));
      } else {
        finish(() => reject(new InvalidImportError("The import parser stopped before completing.")));
      }
    });
  });
}
