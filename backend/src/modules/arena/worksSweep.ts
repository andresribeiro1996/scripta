import type { DatabaseSync } from "node:sqlite";
import { resolveEntryWorks, type SweepBatch, type WorkEntry, type WorkRef, type WorksSweepStep } from "../library/index.js";
import { openArenaDb } from "./adapters/sqlite/connection.js";

type Resolve = (ownerUserId: string, entries: WorkEntry[]) => Map<string, WorkRef>;

export function createArenaWorksStep(db: DatabaseSync, resolve: Resolve): WorksSweepStep {
  const pendingStmt = db.prepare(`
    SELECT rowid, id, owner_user_id FROM tournaments
    WHERE rowid > ? AND (
      EXISTS (SELECT 1 FROM tournament_slots s WHERE s.tournament_id = tournaments.id AND s.work_id IS NULL)
      OR EXISTS (SELECT 1 FROM duels d WHERE d.tournament_id = tournaments.id AND (d.book_a_work_id IS NULL OR d.book_b_work_id IS NULL OR (d.winner_key IS NOT NULL AND d.winner_work_id IS NULL)))
    )
    ORDER BY rowid LIMIT ?
  `);
  const slotsStmt = db.prepare(`SELECT book_key AS key, title, author FROM tournament_slots WHERE tournament_id = ?`);
  const duelSidesStmt = db.prepare(`
    SELECT book_a_key AS key, book_a_title AS title, book_a_author AS author FROM duels WHERE tournament_id = ?
    UNION SELECT book_b_key, book_b_title, book_b_author FROM duels WHERE tournament_id = ?
  `);
  const setSlot = db.prepare(`UPDATE tournament_slots SET work_id = ? WHERE tournament_id = ? AND book_key = ? AND work_id IS NULL`);
  const setSideA = db.prepare(`UPDATE duels SET book_a_work_id = ? WHERE tournament_id = ? AND book_a_key = ? AND book_a_work_id IS NULL`);
  const setSideB = db.prepare(`UPDATE duels SET book_b_work_id = ? WHERE tournament_id = ? AND book_b_key = ? AND book_b_work_id IS NULL`);
  const setWinners = db.prepare(`
    UPDATE duels SET winner_work_id = CASE WHEN winner_key = book_a_key THEN book_a_work_id WHEN winner_key = book_b_key THEN book_b_work_id END
    WHERE tournament_id = ? AND winner_key IS NOT NULL AND winner_work_id IS NULL
  `);
  return (afterRowid, limit): SweepBatch => {
    const tournaments = pendingStmt.all(afterRowid, limit) as Array<{ rowid: number; id: string; owner_user_id: string }>;
    let resolved = 0;
    for (const tournament of tournaments) {
      const rows = [...slotsStmt.all(tournament.id), ...duelSidesStmt.all(tournament.id, tournament.id)] as unknown as WorkEntry[];
      const entries = [...new Map(rows.map((row) => [row.key, row])).values()];
      const works = resolve(tournament.owner_user_id, entries);
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const [key, ref] of works) {
          if (!ref.workId) continue;
          resolved += Number(setSlot.run(ref.workId, tournament.id, key).changes);
          setSideA.run(ref.workId, tournament.id, key);
          setSideB.run(ref.workId, tournament.id, key);
        }
        setWinners.run(tournament.id);
        db.exec("COMMIT");
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    }
    return { lastRowid: tournaments.at(-1)?.rowid ?? afterRowid, visited: tournaments.length, resolved };
  };
}

let arenaStep: WorksSweepStep | null = null;

export function sweepArenaWorks(afterRowid: number, limit: number): SweepBatch {
  arenaStep ??= createArenaWorksStep(openArenaDb(), resolveEntryWorks);
  return arenaStep(afterRowid, limit);
}
