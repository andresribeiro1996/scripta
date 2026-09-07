// Adapter-level tests against a real in-memory SQLite database — the
// actual SQL (the ALTER-based migration, the rotate/revoke statements) is
// exactly what service.test.ts's in-memory fake repo cannot check.

import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratchDir = mkdtempSync(join(tmpdir(), "auth-repo-test-"));
process.env.JWT_ACCESS_SECRET ??= "a".repeat(40);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(40);
process.env.AUTH_DB_PATH ??= join(scratchDir, "auth.sqlite");
process.env.LIBRARY_DB_PATH ??= join(scratchDir, "library.sqlite");
process.env.GALLERY_DB_PATH ??= join(scratchDir, "gallery.sqlite");
process.env.GALLERY_STORAGE_PATH ??= join(scratchDir, "gallery-files");

const { applyAuthMigrations } = await import("./connection.js");
const { createSqliteAuthRepository } = await import("./sqliteAuthRepository.js");

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  applyAuthMigrations(db);
  return db;
}

function columnNames(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

test("a fresh database has the rotation-bookkeeping columns", () => {
  const db = freshDb();
  const cols = columnNames(db, "refresh_tokens");
  assert.ok(cols.includes("rotated_at"));
  assert.ok(cols.includes("replaced_by"));
  assert.ok(cols.includes("granted_via_grace"));
});

test("migrating a pre-4A database adds the columns without losing rows", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, username TEXT UNIQUE,
      password_hash TEXT, google_id TEXT UNIQUE, avatar_id TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE refresh_tokens (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);
  db.prepare(`INSERT INTO users (id, email, username, password_hash) VALUES ('u1','a@b.c','andre','x')`).run();
  db.prepare(`INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ('r1','u1','hash','2099-01-01')`).run();

  applyAuthMigrations(db);

  const cols = columnNames(db, "refresh_tokens");
  assert.ok(cols.includes("rotated_at"));
  assert.ok(cols.includes("replaced_by"));
  assert.ok(cols.includes("granted_via_grace"));
  const row = db.prepare(`SELECT user_id, rotated_at, replaced_by, granted_via_grace FROM refresh_tokens WHERE id = 'r1'`).get() as {
    user_id: string;
    rotated_at: string | null;
    replaced_by: string | null;
    granted_via_grace: number;
  };
  assert.equal(row.user_id, "u1");
  assert.equal(row.rotated_at, null);
  assert.equal(row.replaced_by, null);
  assert.equal(row.granted_via_grace, 0);
});

test("applyAuthMigrations is idempotent", () => {
  const db = freshDb();
  assert.doesNotThrow(() => applyAuthMigrations(db));
  assert.doesNotThrow(() => applyAuthMigrations(db));
});

test("rotateRefreshToken revokes the old row and records rotated_at/replaced_by", () => {
  const db = freshDb();
  const repo = createSqliteAuthRepository(db);
  const user = repo.createUser({ email: "a@b.c", username: "andre", passwordHash: "x", googleId: null });

  const oldId = repo.insertRefreshToken({ userId: user.id, tokenHash: "hash-old", expiresAt: new Date(Date.now() + 60_000) });
  const newId = repo.insertRefreshToken({ userId: user.id, tokenHash: "hash-new", expiresAt: new Date(Date.now() + 60_000) });

  repo.rotateRefreshToken(oldId, newId);

  const oldRow = repo.findRefreshTokenById(oldId);
  assert.ok(oldRow?.revoked_at);
  assert.ok(oldRow?.rotated_at);
  assert.equal(oldRow?.replaced_by, newId);
  assert.equal(oldRow?.granted_via_grace, 0, "a plain rotation is not itself a grace reissue");

  const newRow = repo.findRefreshTokenById(newId);
  assert.equal(newRow?.revoked_at, null);
});

// SHOULD-FIX (one-hop grace) — service.ts's refresh() threads this flag
// through so a row rotated ON SOMEONE ELSE'S BEHALF by the grace path can
// never itself grant a further grace pass.
test("refresh token persistence records granted_via_grace", () => {
  const db = freshDb();
  const repo = createSqliteAuthRepository(db);
  const user = repo.createUser({ email: "a@b.c", username: "andre", passwordHash: "x", googleId: null });

  const oldId = repo.insertRefreshToken({ userId: user.id, tokenHash: "hash-old", expiresAt: new Date(Date.now() + 60_000) });
  const newId = repo.insertRefreshToken({
    userId: user.id,
    tokenHash: "hash-new",
    expiresAt: new Date(Date.now() + 60_000),
    grantedViaGrace: true
  });

  repo.rotateRefreshToken(oldId, newId, { grantedViaGrace: true });

  const oldRow = repo.findRefreshTokenById(oldId);
  assert.equal(oldRow?.granted_via_grace, 1);
  assert.equal(repo.findRefreshTokenById(newId)?.granted_via_grace, 1);
});

test("revokeRefreshToken (logout) leaves rotated_at/replaced_by null", () => {
  const db = freshDb();
  const repo = createSqliteAuthRepository(db);
  const user = repo.createUser({ email: "a@b.c", username: "andre", passwordHash: "x", googleId: null });
  const id = repo.insertRefreshToken({ userId: user.id, tokenHash: "hash", expiresAt: new Date(Date.now() + 60_000) });

  repo.revokeRefreshToken(id);

  const row = repo.findRefreshTokenById(id);
  assert.ok(row?.revoked_at);
  assert.equal(row?.rotated_at, null);
  assert.equal(row?.replaced_by, null);
});

test("revokeAllRefreshTokensForUser only touches that user's still-active tokens", () => {
  const db = freshDb();
  const repo = createSqliteAuthRepository(db);
  const a = repo.createUser({ email: "a@b.c", username: "a", passwordHash: "x", googleId: null });
  const b = repo.createUser({ email: "d@e.f", username: "d", passwordHash: "x", googleId: null });

  const aTokenId = repo.insertRefreshToken({ userId: a.id, tokenHash: "a-hash", expiresAt: new Date(Date.now() + 60_000) });
  const bTokenId = repo.insertRefreshToken({ userId: b.id, tokenHash: "b-hash", expiresAt: new Date(Date.now() + 60_000) });

  repo.revokeAllRefreshTokensForUser(a.id);

  assert.ok(repo.findRefreshTokenById(aTokenId)?.revoked_at);
  assert.equal(repo.findRefreshTokenById(bTokenId)?.revoked_at, null);
});
