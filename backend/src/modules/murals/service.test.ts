import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { FolderCycleError, InvalidFolderReferenceError } from "./domain/errors.js";
import type { MuralsRepository } from "./domain/ports.js";
import type { MuralFolderRow, MuralRow } from "./domain/types.js";
import { createMuralsService } from "./service.js";

function createInMemoryRepo(): MuralsRepository {
  const murals = new Map<string, MuralRow>();
  const folders = new Map<string, MuralFolderRow>();

  return {
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
    update(id, userId, patch) {
      const existing = murals.get(id);
      if (!existing || existing.user_id !== userId) return undefined;
      const merged: MuralRow = { ...existing, ...patch, updated_at: new Date().toISOString() };
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

function makeService() {
  return createMuralsService(createInMemoryRepo(), urlFor);
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

test("createMural carries folderId and defaults to root", () => {
  const service = makeService();
  const f = service.createFolder("u1", "F");
  assert.equal(service.createMural("u1", "M", f.id).folderId, f.id);
  assert.equal(service.createMural("u1", "RootM").folderId, null);
  assert.throws(() => service.createMural("u1", "Bad", UNKNOWN_UUID), InvalidFolderReferenceError);
});

test("openMuralsDb migration is idempotent and preserves data", async () => {
  process.env.JWT_ACCESS_SECRET ??= "a".repeat(40);
  process.env.JWT_REFRESH_SECRET ??= "b".repeat(40);
  const tmpDir = mkdtempSync(join(tmpdir(), "murals-test-"));
  process.env.MURALS_DB_PATH = join(tmpDir, "murals.sqlite");

  const { openMuralsDb } = await import("./adapters/sqlite/connection.js");
  const first = openMuralsDb();
  first.prepare(`INSERT INTO murals (id, user_id, name) VALUES ('m1', 'u1', 'Keep me')`).run();
  first.close();

  const second = openMuralsDb();
  const columns = second.prepare(`PRAGMA table_info(murals)`).all() as { name: string }[];
  assert.ok(columns.some((c) => c.name === "folder_id"));
  const row = second.prepare(`SELECT name FROM murals WHERE id = 'm1'`).get() as { name: string };
  assert.equal(row.name, "Keep me");
  const foldersTable = second
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mural_folders'`)
    .get();
  assert.ok(foldersTable);
  second.close();
});
