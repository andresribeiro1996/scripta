import type { DatabaseSync } from "node:sqlite";
import type { WaitlistRepository } from "../../domain/ports.js";

export function createSqliteWaitlistRepository(db: DatabaseSync): WaitlistRepository {
  const insertStmt = db.prepare(`INSERT OR IGNORE INTO waitlist_entries (email, created_at) VALUES ($email, $created_at)`);
  const listStmt = db.prepare(`SELECT email, created_at FROM waitlist_entries ORDER BY created_at, email`);

  return {
    insert(email, createdAt) {
      insertStmt.run({ $email: email, $created_at: createdAt });
    },
    list() {
      return (listStmt.all() as { email: string; created_at: string }[]).map((row) => ({ email: row.email, createdAt: row.created_at }));
    }
  };
}
