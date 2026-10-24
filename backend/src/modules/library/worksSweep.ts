import type { DatabaseSync } from "node:sqlite";
import { resolveWorks, type WorkLookup } from "../books/index.js";
import { openLibraryDb } from "./adapters/sqlite/connection.js";

export const WORKS_SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const SWEEP_BATCH = 250;

export interface SweepBatch {
  lastRowid: number;
  visited: number;
  resolved: number;
}

export type WorksSweepStep = (afterRowid: number, limit: number) => SweepBatch;

interface SweepLog {
  info(details: object, message: string): void;
}

export function sweepWorks(steps: WorksSweepStep[], log: SweepLog, batch = SWEEP_BATCH): (signal: AbortSignal) => Promise<void> {
  return async (signal) => {
    let resolved = 0;
    for (const step of steps) {
      let after = 0;
      for (;;) {
        await new Promise(setImmediate);
        if (signal.aborted) return;
        const page = step(after, batch);
        resolved += page.resolved;
        if (page.visited < batch) break;
        after = page.lastRowid;
      }
    }
    if (resolved > 0) log.info({ resolved }, "works sweep resolved entries");
  };
}

export function createLibraryWorksStep(db: DatabaseSync, resolve: (lookups: WorkLookup[]) => Array<string | null>): WorksSweepStep {
  const pendingStmt = db.prepare(`
    SELECT rowid, isbn, title, author FROM library_books NOT INDEXED
    WHERE work_id IS NULL AND rowid > ? AND (isbn IS NOT NULL OR title IS NOT NULL)
    ORDER BY rowid LIMIT ?
  `);
  const setStmt = db.prepare(`UPDATE library_books SET work_id = ? WHERE rowid = ? AND work_id IS NULL`);
  return (afterRowid, limit) => {
    const rows = pendingStmt.all(afterRowid, limit) as Array<{ rowid: number; isbn: string | null; title: string | null; author: string | null }>;
    if (rows.length === 0) return { lastRowid: afterRowid, visited: 0, resolved: 0 };
    const ids = resolve(rows.map((row) => ({ isbn: row.isbn, title: row.title, author: row.author })));
    let resolved = 0;
    db.exec("BEGIN IMMEDIATE");
    try {
      rows.forEach((row, index) => {
        const id = ids[index];
        if (id && setStmt.run(id, row.rowid).changes === 1) resolved++;
      });
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
    return { lastRowid: rows[rows.length - 1]!.rowid, visited: rows.length, resolved };
  };
}

let libraryStep: WorksSweepStep | null = null;

export function sweepLibraryWorks(afterRowid: number, limit: number): SweepBatch {
  libraryStep ??= createLibraryWorksStep(openLibraryDb(), resolveWorks);
  return libraryStep(afterRowid, limit);
}
