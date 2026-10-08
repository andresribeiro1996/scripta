import type { DatabaseSync } from "node:sqlite";
import type { ReaderProfile } from "@scripta/shared";
import { parseThemePreference, type ThemeId } from "@scripta/shared/themes";
import { openAuthDb } from "./adapters/sqlite/connection.js";

interface CachedStatements {
  db: DatabaseSync;
  find: ReturnType<DatabaseSync["prepare"]>;
  findIdByUsername: ReturnType<DatabaseSync["prepare"]>;
  search: ReturnType<DatabaseSync["prepare"]>;
  getSeen: ReturnType<DatabaseSync["prepare"]>;
  setSeen: ReturnType<DatabaseSync["prepare"]>;
  getTheme: ReturnType<DatabaseSync["prepare"]>;
  joined: ReturnType<DatabaseSync["prepare"]>;
  rank: ReturnType<DatabaseSync["prepare"]>;
}

let cached: CachedStatements | null = null;
let avatarUrlFor: ((avatarId: string) => string) | undefined;

export function setAvatarUrlFor(fn: (avatarId: string) => string): void {
  avatarUrlFor = fn;
}

function statements(): CachedStatements {
  if (!cached) {
    const db = openAuthDb();
    cached = {
      db,
      find: db.prepare("SELECT username, avatar_id FROM users WHERE id = ?"),
      findIdByUsername: db.prepare("SELECT id FROM users WHERE username = ?"),
      search: db.prepare("SELECT id FROM users WHERE username LIKE ? ESCAPE '\\' ORDER BY username LIMIT ?"),
      getSeen: db.prepare("SELECT dashboard_seen_at FROM users WHERE id = ?"),
      setSeen: db.prepare("UPDATE users SET dashboard_seen_at = ? WHERE id = ?"),
      getTheme: db.prepare("SELECT theme FROM users WHERE id = ?"),
      joined: db.prepare("SELECT created_at, rowid FROM users WHERE id = ?"),
      rank: db.prepare("SELECT COUNT(*) AS n FROM users WHERE created_at < ? OR (created_at = ? AND rowid <= ?)")
    };
  }
  return cached;
}

function toReaderProfile(row: { username: string | null; avatar_id: string | null } | undefined): ReaderProfile | undefined {
  if (!row?.username) return undefined;
  if (!row.avatar_id) return { username: row.username, avatarUrl: null };
  if (!avatarUrlFor) throw new Error("toReaderProfile: no avatarUrlFor configured; the auth module must be registered first.");
  return { username: row.username, avatarUrl: avatarUrlFor(row.avatar_id) };
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

export function getDashboardSeenAt(userId: string): string | null {
  const row = statements().getSeen.get(userId) as { dashboard_seen_at: string | null } | undefined;
  return row?.dashboard_seen_at ?? null;
}

export function setDashboardSeenAt(userId: string, seenAt: string): void {
  statements().setSeen.run(seenAt, userId);
}

export function getUserTheme(userId: string): ThemeId {
  const row = statements().getTheme.get(userId) as { theme: string | null } | undefined;
  const preference = parseThemePreference(row?.theme);
  return preference === "system" ? "light" : preference;
}

export function readerNumberOf(userId: string): number | undefined {
  const row = statements().joined.get(userId) as { created_at: string; rowid: number } | undefined;
  if (!row) return undefined;
  return (statements().rank.get(row.created_at, row.created_at, row.rowid) as { n: number }).n;
}
