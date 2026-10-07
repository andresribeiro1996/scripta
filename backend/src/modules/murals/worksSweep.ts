import type { DatabaseSync } from "node:sqlite";
import { blockReferences } from "@scripta/shared";
import { resolveEntryWorks, type SweepBatch, type WorkEntry, type WorkRef, type WorksSweepStep } from "../library/index.js";
import { openMuralsDb } from "./adapters/sqlite/connection.js";

type Resolve = (ownerUserId: string, entries: WorkEntry[]) => Map<string, WorkRef>;

export function createMuralsWorksStep(db: DatabaseSync, resolve: Resolve): WorksSweepStep {
  const pendingStmt = db.prepare(`
    SELECT rowid, id, user_id, blocks FROM murals
    WHERE rowid > ? AND (
      NOT EXISTS (SELECT 1 FROM mural_works w WHERE w.mural_id = murals.id)
      OR EXISTS (SELECT 1 FROM mural_works w WHERE w.mural_id = murals.id AND w.work_id IS NULL)
    )
    ORDER BY rowid LIMIT ?
  `);
  const deleteStaleWorks = db.prepare(`DELETE FROM mural_works WHERE mural_id = ? AND key NOT IN (SELECT value FROM json_each(?))`);
  const setWork = db.prepare(`
    INSERT INTO mural_works (mural_id, key, work_id) VALUES (?, ?, ?)
    ON CONFLICT(mural_id, key) DO UPDATE SET work_id = excluded.work_id
  `);
  const keepWork = db.prepare(`INSERT OR IGNORE INTO mural_works (mural_id, key, work_id) VALUES (?, ?, NULL)`);
  return (afterRowid, limit): SweepBatch => {
    const murals = pendingStmt.all(afterRowid, limit) as Array<{ rowid: number; id: string; user_id: string; blocks: string }>;
    let resolved = 0;
    for (const mural of murals) {
      const keys = [...blockReferences(JSON.parse(mural.blocks)).bookKeys];
      const works = resolve(mural.user_id, keys.map((key) => ({ key })));
      db.exec("BEGIN IMMEDIATE");
      try {
        deleteStaleWorks.run(mural.id, JSON.stringify([...works.keys()]));
        for (const [key, ref] of works) {
          if (!ref.workId) {
            keepWork.run(mural.id, key);
            continue;
          }
          setWork.run(mural.id, key, ref.workId);
          resolved++;
        }
        db.exec("COMMIT");
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    }
    return { lastRowid: murals.at(-1)?.rowid ?? afterRowid, visited: murals.length, resolved };
  };
}

let muralsStep: WorksSweepStep | null = null;

export function sweepMuralsWorks(afterRowid: number, limit: number): SweepBatch {
  muralsStep ??= createMuralsWorksStep(openMuralsDb(), resolveEntryWorks);
  return muralsStep(afterRowid, limit);
}
