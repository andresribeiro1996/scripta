import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ThemeId } from "@scripta/shared/themes";
import { FolderCycleError, InvalidFolderReferenceError, MuralConflictError } from "./domain/errors.js";
import type { MuralsRepository } from "./domain/ports.js";
import type { MuralFolderRow, MuralRow } from "./domain/types.js";
import { createSqliteMuralsRepository } from "./adapters/sqlite/sqliteMuralsRepository.js";
import { createMuralsService } from "./service.js";

process.env.JWT_ACCESS_SECRET ??= "a".repeat(64);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(64);
process.env.AUTH_DB_PATH ??= join(tmpdir(), "murals-test-auth.sqlite");
process.env.LIBRARY_DB_PATH ??= join(tmpdir(), "murals-test-library.sqlite");
process.env.GALLERY_DB_PATH ??= join(tmpdir(), "murals-test-gallery.sqlite");

function createInMemoryRepo(): MuralsRepository {
  const murals = new Map<string, MuralRow>();
  const folders = new Map<string, MuralFolderRow>();

  return {
    deleteUserData() {},
    rekeyBooks() {},
    listByUser(userId) {
      return [...murals.values()].filter((m) => m.user_id === userId);
    },
    getOwned(id, userId) {
      const m = murals.get(id);
      return m && m.user_id === userId ? m : undefined;
    },
    insert(row) {
      murals.set(row.id, { ...row });
    },
    update(id, userId, patch, expectedUpdatedAt) {
      const existing = murals.get(id);
      if (!existing || existing.user_id !== userId) return undefined;
      if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== existing.updated_at) return undefined;
      const merged: MuralRow = { ...existing, ...patch, updated_at: new Date(Date.parse(existing.updated_at) + 1).toISOString() };
      murals.set(id, merged);
      return merged;
    },
    delete(id, userId) {
      const existing = murals.get(id);
      if (!existing || existing.user_id !== userId) return false;
      murals.delete(id);
      return true;
    },
    setShareToken(id, userId, token) {
      const existing = murals.get(id);
      if (!existing || existing.user_id !== userId) return undefined;
      const updated: MuralRow = { ...existing, share_token: token, updated_at: new Date().toISOString() };
      murals.set(id, updated);
      return updated;
    },
    getByShareToken(token) {
      return [...murals.values()].find((m) => m.share_token === token);
    },
    listFoldersByUser(userId) {
      return [...folders.values()].filter((f) => f.user_id === userId);
    },
    getOwnedFolder(id, userId) {
      const f = folders.get(id);
      return f && f.user_id === userId ? f : undefined;
    },
    insertFolder(row) {
      folders.set(row.id, { ...row });
    },
    updateFolder(id, userId, patch) {
      const existing = folders.get(id);
      if (!existing || existing.user_id !== userId) return undefined;
      const merged: MuralFolderRow = { ...existing, ...patch, updated_at: new Date().toISOString() };
      folders.set(id, merged);
      return merged;
    },
    reparentFolderChildren(folderId, userId, parentId) {
      const now = new Date().toISOString();
      for (const f of folders.values()) {
        if (f.parent_id === folderId && f.user_id === userId) {
          folders.set(f.id, { ...f, parent_id: parentId, updated_at: now });
        }
      }
      for (const m of murals.values()) {
        if (m.folder_id === folderId && m.user_id === userId) {
          murals.set(m.id, { ...m, folder_id: parentId, updated_at: now });
        }
      }
    },
    deleteFolder(id, userId) {
      const existing = folders.get(id);
      if (!existing || existing.user_id !== userId) return false;
      folders.delete(id);
      return true;
    }
  };
}

const urlFor = (token: string) => `http://x/shared/murals/${token}`;

function makeService(ownerTheme: ThemeId = "light") {
  return createMuralsService(createInMemoryRepo(), urlFor, () => ownerTheme);
}

const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000";

test("createFolder stores folders and listFolders returns insertion order per user", () => {
  const service = makeService();
  const a = service.createFolder("u1", "Books");
  const b = service.createFolder("u1", "Quotes", a.id);
  service.createFolder("u2", "Theirs");
  assert.deepEqual(
    service.listFolders("u1").map((f) => f.id),
    [a.id, b.id]
  );
  assert.equal(service.listFolders("u1")[1]!.parentId, a.id);
  assert.equal(service.listFolders("u1").length, 2);
});

test("createFolder rejects an unknown parent", () => {
  const service = makeService();
  assert.throws(() => service.createFolder("u1", "X", UNKNOWN_UUID), InvalidFolderReferenceError);
});

test("createFolder rejects another user's folder as parent", () => {
  const service = makeService();
  const theirs = service.createFolder("u2", "Theirs");
  assert.throws(() => service.createFolder("u1", "X", theirs.id), InvalidFolderReferenceError);
});

test("renameFolder returns undefined for an unowned folder", () => {
  const service = makeService();
  const theirs = service.createFolder("u2", "Theirs");
  assert.equal(service.renameFolder("u1", theirs.id, "New"), undefined);
});

test("moveFolder rejects moving a folder into itself", () => {
  const service = makeService();
  const a = service.createFolder("u1", "A");
  assert.throws(() => service.moveFolder("u1", a.id, a.id), FolderCycleError);
});

test("moveFolder rejects moving a folder into its own descendant", () => {
  const service = makeService();
  const a = service.createFolder("u1", "A");
  const b = service.createFolder("u1", "B", a.id);
  const c = service.createFolder("u1", "C", b.id);
  assert.throws(() => service.moveFolder("u1", a.id, b.id), FolderCycleError);
  assert.throws(() => service.moveFolder("u1", a.id, c.id), FolderCycleError);
});

test("moveFolder rejects an unknown or unowned target and allows root", () => {
  const service = makeService();
  const a = service.createFolder("u1", "A");
  const b = service.createFolder("u1", "B", a.id);
  assert.throws(() => service.moveFolder("u1", b.id, UNKNOWN_UUID), InvalidFolderReferenceError);
  const theirs = service.createFolder("u2", "Theirs");
  assert.throws(() => service.moveFolder("u1", b.id, theirs.id), InvalidFolderReferenceError);
  const toRoot = service.moveFolder("u1", b.id, null);
  assert.equal(toRoot?.parentId, null);
  const backIn = service.moveFolder("u1", b.id, a.id);
  assert.equal(backIn?.parentId, a.id);
});

test("deleteFolder splices child folders and murals up one level", () => {
  const service = makeService();
  const root = service.createFolder("u1", "Root");
  const mid = service.createFolder("u1", "Mid", root.id);
  const leaf = service.createFolder("u1", "Leaf", mid.id);
  const m1 = service.createMural("u1", "In mid", mid.id);
  const m2 = service.createMural("u1", "In leaf", leaf.id);

  assert.equal(service.deleteFolder("u1", mid.id), true);

  const leafAfter = service.listFolders("u1").find((f) => f.id === leaf.id);
  assert.equal(leafAfter?.parentId, root.id);
  assert.equal(service.getMural("u1", m1.id)?.folderId, root.id);
  assert.equal(service.getMural("u1", m2.id)?.folderId, leaf.id);
});

test("deleteFolder returns false for an unowned folder", () => {
  const service = makeService();
  const theirs = service.createFolder("u2", "Theirs");
  assert.equal(service.deleteFolder("u1", theirs.id), false);
});

test("updateMural rejects an unknown folderId", () => {
  const service = makeService();
  const m = service.createMural("u1", "M");
  assert.throws(() => service.updateMural("u1", m.id, { folderId: UNKNOWN_UUID }), InvalidFolderReferenceError);
});

test("updateMural rejects another user's folderId", () => {
  const service = makeService();
  const m = service.createMural("u1", "M");
  const theirs = service.createFolder("u2", "Theirs");
  assert.throws(() => service.updateMural("u1", m.id, { folderId: theirs.id }), InvalidFolderReferenceError);
});

test("updateMural moves a mural into a folder and back to root", () => {
  const service = makeService();
  const m = service.createMural("u1", "M");
  const f = service.createFolder("u1", "F");
  const inFolder = service.updateMural("u1", m.id, { folderId: f.id });
  assert.equal(inFolder?.folderId, f.id);
  const atRoot = service.updateMural("u1", m.id, { folderId: null });
  assert.equal(atRoot?.folderId, null);
});

test("updateMural rejects a stale save without overwriting the current mural", () => {
  const service = makeService();
  const mural = service.createMural("u1", "Original");
  const current = service.updateMural("u1", mural.id, { name: "Current", updatedAt: mural.updatedAt });
  assert.throws(() => service.updateMural("u1", mural.id, { name: "Stale", updatedAt: mural.updatedAt }), MuralConflictError);
  assert.equal(service.getMural("u1", mural.id)?.name, "Current");
  assert.notEqual(current?.updatedAt, mural.updatedAt);
});

test("createMural carries folderId and defaults to root", () => {
  const service = makeService();
  const f = service.createFolder("u1", "F");
  assert.equal(service.createMural("u1", "M", f.id).folderId, f.id);
  assert.equal(service.createMural("u1", "RootM").folderId, null);
  assert.throws(() => service.createMural("u1", "Bad", UNKNOWN_UUID), InvalidFolderReferenceError);
});

test("updateMural stores a shelf block's role as sent", () => {
  const service = makeService();
  const mural = service.createMural("u1", "M");
  service.updateMural("u1", mural.id, { blocks: [{ id: "b1", type: "shelf", layout: { x: 0, y: 0, w: 12, h: 5 }, title: "Finished", bookKeys: [], role: "finished" }] });
  const blocks = service.getMural("u1", mural.id)?.blocks as Array<{ role?: string }>;
  assert.equal(blocks[0]!.role, "finished");
});

test("openMuralsDb migration is idempotent and preserves data", async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "murals-test-"));
  process.env.MURALS_DB_PATH = join(tmpDir, "murals.sqlite");

  const { openMuralsDb } = await import("./adapters/sqlite/connection.js");
  const first = openMuralsDb();
  first.prepare(`INSERT INTO murals (id, user_id, name) VALUES ('m1', 'u1', 'Keep me')`).run();
  first.close();

  const second = openMuralsDb();
  const columns = second.prepare(`PRAGMA table_info(murals)`).all() as { name: string }[];
  assert.ok(columns.some((c) => c.name === "folder_id"));
  assert.ok(columns.some((c) => c.name === "theme"));
  const row = second.prepare(`SELECT name FROM murals WHERE id = 'm1'`).get() as { name: string };
  assert.equal(row.name, "Keep me");
  const repository = createSqliteMuralsRepository(second);
  const before = repository.getOwned("m1", "u1")!;
  const current = repository.update("m1", "u1", { name: "Current" }, before.updated_at);
  assert.equal(repository.update("m1", "u1", { name: "Stale" }, before.updated_at), undefined);
  assert.equal(repository.getOwned("m1", "u1")?.name, "Current");
  assert.notEqual(current?.updated_at, before.updated_at);
  const foldersTable = second
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mural_folders'`)
    .get();
  assert.ok(foldersTable);
  second.close();
});

test("createMural stores an explicit theme and defaults to the owner's account theme", () => {
  const service = makeService("sepia");
  assert.equal(service.createMural("u1", "Explicit", null, "dark").theme, "dark");
  assert.equal(service.createMural("u1", "Default").theme, "sepia");
});

test("updateMural changes only the theme and persists it", () => {
  const service = makeService();
  const mural = service.createMural("u1", "M");
  const updated = service.updateMural("u1", mural.id, { theme: "forest" });
  assert.equal(updated?.theme, "forest");
  assert.equal(updated?.name, "M");
  assert.equal(service.getMural("u1", mural.id)?.theme, "forest");
});

test("murals routes validate theme on create and update", async () => {
  const { buildMuralRoutes } = await import("./routes.js");
  const { getAuthenticatedUserFromAccessToken } = await import("../auth/tokens.js");
  const { default: Fastify } = await import("fastify");
  const { default: jwt } = await import("jsonwebtoken");
  const service = makeService("midnight");
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => getAuthenticatedUserFromAccessToken(token, (id) => ({
    id, email: `${id}@example.test`, username: id, avatar_id: null, google_id: null, password_hash: null, created_at: ""
  })));
  await app.register(buildMuralRoutes(service));
  const headers = { authorization: `Bearer ${jwt.sign({ sub: "u1", email: "u1@example.test", username: "u1" }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "5m" })}` };

  assert.equal((await app.inject({ method: "POST", url: "/murals", headers, payload: { name: "Bad", theme: "vaporwave" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/murals", headers, payload: { name: "Bad", theme: "system" } })).statusCode, 400);
  const created = await app.inject({ method: "POST", url: "/murals", headers, payload: { name: "Older client" } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().theme, "midnight");
  const chosen = await app.inject({ method: "POST", url: "/murals", headers, payload: { name: "Chosen", theme: "matrix" } });
  assert.equal(chosen.json().theme, "matrix");

  const id = created.json().id;
  assert.equal((await app.inject({ method: "PUT", url: `/murals/${id}`, headers, payload: { theme: "vaporwave" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "PUT", url: `/murals/${id}`, headers, payload: {} })).statusCode, 400);
  const updated = await app.inject({ method: "PUT", url: `/murals/${id}`, headers, payload: { theme: "oxblood" } });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().theme, "oxblood");
  await app.close();
});

test("public payload carries the mural's theme", async () => {
  const { resolveMuralPublicPayload } = await import("./domain/publicPayload.js");
  const service = makeService();
  const mural = service.createMural("u1", "Shared", null, "synthwave");
  const row = { id: mural.id, user_id: "u1", name: "Shared", theme: "synthwave", blocks: "[]", cover_image_id: null, cover_image_url: null, share_token: null, folder_id: null, created_at: "", updated_at: "" };
  assert.equal(resolveMuralPublicPayload(row, []).mural.theme, "synthwave");
});

test("backfillMuralThemes sets only NULL themes from each owner's resolved theme", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readFileSync } = await import("node:fs");
  const { backfillMuralThemes } = await import("./migration.js");
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./adapters/sqlite/schema.sql", import.meta.url), "utf8"));
  const insert = db.prepare("INSERT INTO murals (id, user_id, name, theme) VALUES (?, ?, 'M', ?)");
  insert.run("a1", "u1", null);
  insert.run("a2", "u1", "dark");
  insert.run("b1", "u2", null);
  const themeFor = (userId: string): ThemeId => (userId === "u1" ? "sepia" : "light");

  backfillMuralThemes(themeFor, db);
  const themes = () => Object.fromEntries((db.prepare("SELECT id, theme FROM murals").all() as Array<{ id: string; theme: string }>).map((r) => [r.id, r.theme]));
  assert.deepEqual(themes(), { a1: "sepia", a2: "dark", b1: "light" });

  backfillMuralThemes(() => "forest", db);
  assert.deepEqual(themes(), { a1: "sepia", a2: "dark", b1: "light" });
  db.close();
});
