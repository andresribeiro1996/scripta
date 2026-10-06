import type { DatabaseSync } from "node:sqlite";

const hasColumn = (db: DatabaseSync, table: string, column: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === column);

export function migrateArenaToWorks(db: DatabaseSync): void {
  if (!hasColumn(db, "tournament_slots", "book_key")) return;
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (hasColumn(db, "tournament_slots", "book_key")) {
        db.exec(`
          CREATE TABLE tournament_slots_new (
            tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
            slot_index INTEGER NOT NULL,
            work_id TEXT,
            title TEXT NOT NULL,
            author TEXT NOT NULL,
            cover_url TEXT,
            PRIMARY KEY (tournament_id, slot_index)
          );
          INSERT INTO tournament_slots_new (tournament_id, slot_index, work_id, title, author, cover_url)
            SELECT tournament_id, slot_index, work_id, title, author, cover_url FROM tournament_slots;
          DROP TABLE tournament_slots;
          ALTER TABLE tournament_slots_new RENAME TO tournament_slots;

          CREATE TABLE votes_new (
            id TEXT PRIMARY KEY,
            duel_id TEXT NOT NULL REFERENCES duels(id) ON DELETE CASCADE,
            voter_token TEXT NOT NULL,
            voter_user_id TEXT,
            side TEXT NOT NULL CHECK (side IN ('a', 'b')),
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            UNIQUE (duel_id, voter_token)
          );
          INSERT INTO votes_new (id, duel_id, voter_token, voter_user_id, side, created_at)
            SELECT v.id, v.duel_id, v.voter_token, v.voter_user_id, CASE WHEN v.book_key = d.book_a_key THEN 'a' ELSE 'b' END, v.created_at
            FROM votes AS v JOIN duels AS d ON d.id = v.duel_id
            WHERE v.book_key IN (d.book_a_key, d.book_b_key);
          DROP TABLE votes;

          CREATE TABLE duels_new (
            id TEXT PRIMARY KEY,
            tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
            round_number INTEGER NOT NULL,
            duel_index INTEGER NOT NULL,
            book_a_work_id TEXT,
            book_a_title TEXT NOT NULL,
            book_a_author TEXT NOT NULL,
            book_a_cover TEXT,
            book_b_work_id TEXT,
            book_b_title TEXT NOT NULL,
            book_b_author TEXT NOT NULL,
            book_b_cover TEXT,
            winner_side TEXT CHECK (winner_side IN ('a', 'b')),
            status TEXT NOT NULL DEFAULT 'active',
            opens_at TEXT NOT NULL,
            closes_at TEXT NOT NULL,
            settled_at TEXT
          );
          INSERT INTO duels_new (id, tournament_id, round_number, duel_index, book_a_work_id, book_a_title, book_a_author, book_a_cover,
              book_b_work_id, book_b_title, book_b_author, book_b_cover, winner_side, status, opens_at, closes_at, settled_at)
            SELECT id, tournament_id, round_number, duel_index, book_a_work_id, book_a_title, book_a_author, book_a_cover,
              book_b_work_id, book_b_title, book_b_author, book_b_cover,
              CASE WHEN winner_key = book_a_key THEN 'a' WHEN winner_key = book_b_key THEN 'b' END,
              status, opens_at, closes_at, settled_at
            FROM duels;
          DROP TABLE duels;
          ALTER TABLE duels_new RENAME TO duels;
          ALTER TABLE votes_new RENAME TO votes;
          PRAGMA user_version = 1;
        `);
      }
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
  const broken = db.prepare("PRAGMA foreign_key_check").all();
  if (broken.length > 0) throw new Error(`arena works pass left ${broken.length} broken foreign keys`);
}
