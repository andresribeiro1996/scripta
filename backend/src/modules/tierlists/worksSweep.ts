import type { DatabaseSync } from "node:sqlite";
import { resolveEntryWorks, type SweepBatch, type WorkEntry, type WorkRef, type WorksSweepStep } from "../library/index.js";
import { openTierlistsDb } from "./adapters/sqlite/connection.js";
import { boardKeys } from "./domain/boardKeys.js";

type Resolve = (ownerUserId: string, entries: WorkEntry[]) => Map<string, WorkRef>;
type SnapshotBook = { title?: string; author?: string; isbn?: string | null };

function entriesOf(data: string, publicBooks: string | null): WorkEntry[] {
  const board: unknown = JSON.parse(data);
  const poolValue = board && typeof board === "object" ? (board as { pool?: unknown }).pool : undefined;
  const pool = Array.isArray(poolValue) ? poolValue : [];
  const parsed: unknown = publicBooks ? JSON.parse(publicBooks) : null;
  const snapshot = Array.isArray(parsed) && parsed.length === pool.length ? (parsed as SnapshotBook[]) : [];
  return boardKeys(board).map((key) => {
    const book = snapshot[pool.indexOf(key)];
    return { key, title: book?.title ?? null, author: book?.author ?? null, isbn: book?.isbn ?? null };
  });
}

export function createTierlistsWorksStep(db: DatabaseSync, resolve: Resolve): WorksSweepStep {
  const pendingStmt = db.prepare(`
    SELECT rowid, id, origin_user_id, data, public_books FROM tierlists
    WHERE rowid > ? AND (
      NOT EXISTS (SELECT 1 FROM tierlist_works w WHERE w.tierlist_id = tierlists.id)
      OR EXISTS (SELECT 1 FROM tierlist_works w WHERE w.tierlist_id = tierlists.id AND w.work_id IS NULL)
      OR EXISTS (SELECT 1 FROM tierlist_ballot_placements p WHERE p.tierlist_id = tierlists.id AND p.work_id IS NULL)
    )
    ORDER BY rowid LIMIT ?
  `);
  const deleteStaleWorks = db.prepare(`DELETE FROM tierlist_works WHERE tierlist_id = ? AND key NOT IN (SELECT value FROM json_each(?))`);
  const setWork = db.prepare(`
    INSERT INTO tierlist_works (tierlist_id, key, work_id) VALUES (?, ?, ?)
    ON CONFLICT(tierlist_id, key) DO UPDATE SET work_id = excluded.work_id
  `);
  const keepWork = db.prepare(`INSERT OR IGNORE INTO tierlist_works (tierlist_id, key, work_id) VALUES (?, ?, NULL)`);
  const fillPlacements = db.prepare(`
    UPDATE tierlist_ballot_placements SET work_id = (SELECT w.work_id FROM tierlist_works w WHERE w.tierlist_id = tierlist_ballot_placements.tierlist_id AND w.key = tierlist_ballot_placements.book_key)
    WHERE tierlist_id = ? AND work_id IS NULL
  `);
  return (afterRowid, limit): SweepBatch => {
    const lists = pendingStmt.all(afterRowid, limit) as Array<{ rowid: number; id: string; origin_user_id: string; data: string; public_books: string | null }>;
    let resolved = 0;
    for (const list of lists) {
      const works = resolve(list.origin_user_id, entriesOf(list.data, list.public_books));
      db.exec("BEGIN IMMEDIATE");
      try {
        deleteStaleWorks.run(list.id, JSON.stringify([...works.keys()]));
        for (const [key, ref] of works) {
          if (!ref.workId) {
            keepWork.run(list.id, key);
            continue;
          }
          setWork.run(list.id, key, ref.workId);
          resolved++;
        }
        fillPlacements.run(list.id);
        db.exec("COMMIT");
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    }
    return { lastRowid: lists.at(-1)?.rowid ?? afterRowid, visited: lists.length, resolved };
  };
}

let tierlistsStep: WorksSweepStep | null = null;

export function sweepTierlistsWorks(afterRowid: number, limit: number): SweepBatch {
  tierlistsStep ??= createTierlistsWorksStep(openTierlistsDb(), resolveEntryWorks);
  return tierlistsStep(afterRowid, limit);
}
