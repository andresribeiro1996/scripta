import type { DatabaseSync } from "node:sqlite";
import type { WaitlistRepository } from "../../domain/ports.js";

export function createSqliteWaitlistRepository(db: DatabaseSync): WaitlistRepository {
  const insertStmt = db.prepare(`INSERT OR IGNORE INTO waitlist_entries (email, created_at) VALUES ($email, $created_at)`);

  return {
    insert(email, createdAt) {
      insertStmt.run({ $email: email, $created_at: createdAt });
    }
  };
}
