import type { DatabaseSync } from "node:sqlite";
import type { ReaderProfile } from "@scripta/shared";
import { env } from "../../config/env.js";
import { openAuthDb } from "./adapters/sqlite/connection.js";

interface CachedStatements {
  db: DatabaseSync;
  find: ReturnType<DatabaseSync["prepare"]>;
  findIdByUsername: ReturnType<DatabaseSync["prepare"]>;
  search: ReturnType<DatabaseSync["prepare"]>;
}

let cached: CachedStatements | null = null;

function statements(): CachedStatements {
  if (!cached) {
    const db = openAuthDb();
    cached = {
      db,
      find: db.prepare("SELECT username, avatar_id FROM users WHERE id = ?"),
      findIdByUsername: db.prepare("SELECT id FROM users WHERE username = ?"),
      search: db.prepare("SELECT id FROM users WHERE username LIKE ? ESCAPE '\\' ORDER BY username LIMIT ?")
    };
  }
  return cached;
}

function toReaderProfile(row: { username: string | null; avatar_id: string | null } | undefined): ReaderProfile | undefined {
  if (!row?.username) return undefined;
  return { username: row.username, avatarUrl: row.avatar_id ? `${env.PUBLIC_API_URL}/auth/avatar/${row.avatar_id}/file` : null };
}

export function resolvePublicReaderProfile(userId: string): ReaderProfile | undefined {
  return toReaderProfile(statements().find.get(userId) as { username: string | null; avatar_id: string | null } | undefined);
}

export function resolvePublicReaderProfiles(userIds: string[]): Map<string, ReaderProfile> {
  const out = new Map<string, ReaderProfile>();
  for (const userId of userIds) {
    const profile = resolvePublicReaderProfile(userId);
    if (profile) out.set(userId, profile);
  }
  return out;
}

export function userHasUsername(userId: string): boolean {
  return Boolean((statements().find.get(userId) as { username: string | null } | undefined)?.username);
}

export function findUserIdByUsername(username: string): string | undefined {
  const row = statements().findIdByUsername.get(username) as { id: string } | undefined;
  return row?.id;
}

export function searchUsernameOwners(query: string, limit: number): string[] {
  const escaped = query.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const rows = statements().search.all(`%${escaped}%`, limit) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}
