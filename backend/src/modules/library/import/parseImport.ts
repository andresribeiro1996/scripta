import type { LibraryData } from "@scripta/shared";
import { fork } from "node:child_process";

const MAX_IMPORT_ROWS = 100_000;
const CHILD_MEMORY_MB = 64;

export class InvalidImportError extends Error {}
export class ImportTimeoutError extends InvalidImportError {}

export interface ImportPreview {
  data: LibraryData;
  warnings: string[];
}

export function parseImport(path: string, timeoutMs: number, maxResultBytes: number): Promise<ImportPreview> {
  return new Promise((resolve, reject) => {
    const sourceUrl = new URL(import.meta.url.endsWith(".ts") ? "./importChild.ts" : "./importChild.js", import.meta.url);
    const child = fork(sourceUrl, [path, String(MAX_IMPORT_ROWS), String(maxResultBytes), String(CHILD_MEMORY_MB * 1024 * 1024)], {
      execArgv: [...process.execArgv, `--max-old-space-size=${CHILD_MEMORY_MB}`],
      stdio: ["ignore", "ignore", "ignore", "ipc"]
    });
    let settled = false;
    let timedOut = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
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
        : reject(new InvalidImportError(message.error ?? "Couldn't parse that import file.")));
    });
    child.once("error", (error) => {
      if (!timedOut) finish(() => reject(new InvalidImportError(error.message)));
    });
    child.once("exit", (_code, signal) => {
      if (timedOut && signal === "SIGKILL") {
        finish(() => reject(new ImportTimeoutError("The import file took too long to parse.")));
      } else {
        finish(() => reject(new InvalidImportError("The import parser stopped before completing.")));
      }
    });
  });
}
