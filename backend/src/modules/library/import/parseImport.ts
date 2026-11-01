import type { LibraryData } from "@scripta/shared";
import { sharedT, type Locale } from "@scripta/shared/i18n";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { t, type BackendKey } from "../../../i18n/index.js";
import { importTooLargeMessage } from "../domain/sizeLimit.js";

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

const SHARED_IMPORT_ERRORS = [
  "shared.csv.invalidQuoting",
  "shared.csv.noBooks",
  "shared.csv.duplicateColumns",
  "shared.csv.fieldCount",
  "shared.csv.titleAuthor",
  "shared.csv.isbn",
  "shared.csv.status",
  "shared.csv.rating",
  "shared.csv.seriesNumber",
  "shared.csv.date",
  "shared.csv.decode",
  "shared.csv.goodreadsEmpty",
  "shared.csv.storygraphEmpty"
] as const;

const SAFE_IMPORT_ERRORS = [
  "library.importTooManyRows",
  "library.importKoboColumns",
  "library.importJsonNoBooks",
  "library.importUnrecognizedFile",
  "library.importUnrecognizedCalibre",
  "library.importUnrecognizedTsv",
  "library.importUnrecognizedBookwyrm",
  "library.importCsvFailed",
  "library.importTimeout",
  "library.importStopped"
] as const satisfies readonly BackendKey[];

const SAFE_TABLE_ERROR = /^`(content|Bookmark)` must be a real SQLite table\.$/;

export function sanitizeImportError(raw: string | undefined, maxResultBytes: number, locale: Locale): string {
  if (!raw) return t(locale, "library.importFailed");
  const shared = SHARED_IMPORT_ERRORS.find((key) => sharedT("en")(key) === raw);
  if (shared) return sharedT(locale)(shared);
  const safe = SAFE_IMPORT_ERRORS.find((key) => t("en", key) === raw);
  if (safe) return t(locale, safe);
  const table = SAFE_TABLE_ERROR.exec(raw)?.[1];
  if (table) return t(locale, "library.importNotTable", { table });
  if (raw === importTooLargeMessage("en", maxResultBytes)) return importTooLargeMessage(locale, maxResultBytes);
  return t(locale, "library.importFailed");
}

let inFlight = 0;

type ImportLogger = { warn(...args: unknown[]): void };

export function parseImport(path: string, timeoutMs: number, maxResultBytes: number, locale: Locale, logger: ImportLogger = console): Promise<ImportPreview> {
  if (inFlight >= MAX_PARALLEL_IMPORTS) {
    return Promise.reject(new ImportBusyError(t(locale, "library.importBusy")));
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
        : reject(new InvalidImportError(sanitizeImportError(message.error, maxResultBytes, locale))));
    });
    child.once("error", (error) => {
      if (!settled) logger.warn({ err: error }, "import parser child failed to spawn");
      if (!timedOut) finish(() => reject(new InvalidImportError(t(locale, "library.importFailed"))));
    });
    child.once("exit", (code, signal) => {
      if (!settled) logger.warn({ code, signal }, "import parser child exited before sending a result");
      if (timedOut && signal === "SIGKILL") {
        finish(() => reject(new ImportTimeoutError(t(locale, "library.importTimeout"))));
      } else {
        finish(() => reject(new InvalidImportError(t(locale, "library.importStopped"))));
      }
    });
  });
}
