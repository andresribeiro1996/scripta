// Opens (and migrates) this module's own SQLite database — mirrors
// modules/covers/adapters/sqlite/connection.ts exactly.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../../config/env.js";

const adapterDir = dirname(fileURLToPath(import.meta.url));

export function openArenaDb(): DatabaseSync {
  mkdirSync(dirname(env.ARENA_DB_PATH), { recursive: true });

  const db = new DatabaseSync(env.ARENA_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");

  applyArenaMigrations(db);

  return db;
}

/** Schema + column migrations, split out from openArenaDb so it can run
 *  against an in-memory database in tests — same shape as
 *  modules/tierlists' applyTierlistsMigrations. The voter_user_id ALTER
 *  must run BEFORE the schema: schema.sql's partial index on the column
 *  would fail to create against a pre-existing votes table that lacks it. */
export function applyArenaMigrations(db: DatabaseSync): void {
  const votesExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='votes'`)
    .get() as { name: string } | undefined;
  if (votesExists) {
    const columns = db.prepare(`PRAGMA table_info(votes)`).all() as { name: string }[];
    if (!columns.some((column) => column.name === "voter_user_id")) {
      db.exec(`ALTER TABLE votes ADD COLUMN voter_user_id TEXT`);
    }
    // One-time, before schema.sql creates idx_votes_duel_user: the same
    // account may legitimately hold several votes on one duel already
    // (one per device token, backfilled by linkVotesToUser), and the
    // unique index refuses to create over those. Keep the earliest vote
    // of each (duel, account) group — the one that locked the duel in
    // for that voter at the time — and drop the later duplicates.
    const duelUserIndexExists = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_votes_duel_user'`)
      .get();
    if (!duelUserIndexExists) {
      db.exec(
        `DELETE FROM votes WHERE voter_user_id IS NOT NULL AND rowid NOT IN ` +
          `(SELECT MIN(rowid) FROM votes WHERE voter_user_id IS NOT NULL GROUP BY duel_id, voter_user_id)`
      );
    }
  }

  const schema = readFileSync(`${adapterDir}/schema.sql`, "utf8");
  db.exec(schema);
}
