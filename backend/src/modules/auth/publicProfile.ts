import type { DatabaseSync } from "node:sqlite";
import type { ReaderProfile } from "@scripta/shared";
import { env } from "../../config/env.js";
import { openAuthDb } from "./adapters/sqlite/connection.js";

let cached: { db: DatabaseSync; find: ReturnType<DatabaseSync["prepare"]> } | null = null;

export function resolvePublicReaderProfile(userId: string): ReaderProfile | undefined {
  if (!cached) {
    const db = openAuthDb();
    cached = { db, find: db.prepare("SELECT username, avatar_id FROM users WHERE id = ?") };
  }
  const row = cached.find.get(userId) as { username: string | null; avatar_id: string | null } | undefined;
  if (!row?.username) return undefined;
  return { username: row.username, avatarUrl: row.avatar_id ? `${env.PUBLIC_API_URL}/auth/avatar/${row.avatar_id}/file` : null };
}
