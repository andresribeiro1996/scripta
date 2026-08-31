# Mural Folders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nested, file-tree folder organization for murals — folder tree in a left panel on the Murals page, card grid on the right, backed by a new `mural_folders` table and `folder_id` on murals.

**Architecture:** Adjacency-list folders in the backend `murals` module (new table + nullable `folder_id` column, folder CRUD routes, cycle guard and splice-on-delete in the service). Frontend adds an API/hooks/data layer, a tree panel + move-to-folder modal, and reworks `MuralsListPage` into a two-pane layout. Spec: `docs/superpowers/specs/2026-08-31-mural-folders-design.md`.

**Tech Stack:** Fastify + TypeScript + better-`node:sqlite` (backend, hexagonal module), React 19 + Vite + TanStack Query + Tailwind (frontend). No new dependencies anywhere.

**Spec:** `docs/superpowers/specs/2026-08-31-mural-folders-design.md`

## Global Constraints

- No new npm dependencies (backend or frontend).
- No code comments — AGENTS.md rule; existing files are comment-heavy but new/edited code adds none.
- Backend tests: `node:test` run via `tsx --test`, following `backend/src/modules/arena/service.test.ts`'s in-memory-repo pattern.
- DB columns snake_case, TS fields camelCase, DTO mapping in `service.ts` (existing convention).
- Ownership misses → 404 (undefined/false from service); invalid folder references and cycle moves → typed errors → 400.
- Cross-module imports only via a module's `index.ts` public surface.
- Public share view (`GET /murals/shared/:token`) is untouched — folders never appear in it.
- Run `npm run typecheck` (backend and frontend) and `npm run lint` (frontend) after every task; run `npm test` (backend) after Tasks 2+.

---

### Task 1: Backend storage — folders table, `folder_id` column, domain types, repository

**Files:**
- Modify: `backend/src/modules/murals/adapters/sqlite/schema.sql`
- Modify: `backend/src/modules/murals/adapters/sqlite/connection.ts`
- Modify: `backend/src/modules/murals/domain/types.ts`
- Modify: `backend/src/modules/murals/domain/ports.ts`
- Modify: `backend/src/modules/murals/adapters/sqlite/sqliteMuralsRepository.ts`

**Interfaces:**
- Consumes: existing `MuralsRepository`, `MuralRow`.
- Produces: `MuralFolderRow` and `MuralFolder` types; `MuralsRepository` extended with `listFoldersByUser(userId: string): MuralFolderRow[]`, `getOwnedFolder(id: string, userId: string): MuralFolderRow | undefined`, `insertFolder(row: MuralFolderRow): void`, `updateFolder(id: string, userId: string, patch: Partial<Pick<MuralFolderRow, "name" | "parent_id">>): MuralFolderRow | undefined`, `reparentFolderChildren(folderId: string, userId: string, parentId: string | null): void`, `deleteFolder(id: string, userId: string): boolean`; `MuralRow.folder_id: string | null`; murals `update()` patch now includes `folder_id`.

- [ ] **Step 1: Add the `mural_folders` table and `folder_id` column to schema.sql**

Two edits to `backend/src/modules/murals/adapters/sqlite/schema.sql`:

Edit 1 — add `folder_id TEXT,` to the existing `murals` CREATE TABLE (after the `share_token` line), making it:

```sql
CREATE TABLE IF NOT EXISTS murals (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  name             TEXT NOT NULL,
  blocks           TEXT NOT NULL DEFAULT '[]',
  cover_image_id   TEXT,
  cover_image_url  TEXT,
  share_token      TEXT UNIQUE,
  folder_id        TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
```

Edit 2 — append the folders table at the end of the file:

```sql
CREATE TABLE IF NOT EXISTS mural_folders (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  parent_id  TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_mural_folders_user_id ON mural_folders(user_id);
```

- [ ] **Step 2: Add the idempotent column retrofit to connection.ts**

In `backend/src/modules/murals/adapters/sqlite/connection.ts`, after `db.exec(schema);` and before `return db;`, add (this mirrors `modules/library/adapters/sqlite/connection.ts:22-31` exactly — the `CREATE TABLE IF NOT EXISTS` above cannot add a column to an existing table):

```ts
  const columns = db.prepare(`PRAGMA table_info(murals)`).all() as { name: string }[];
  if (!columns.some((c) => c.name === "folder_id")) {
    db.exec(`ALTER TABLE murals ADD COLUMN folder_id TEXT`);
  }
```

- [ ] **Step 3: Extend domain types**

In `backend/src/modules/murals/domain/types.ts`:

Add `folder_id: string | null;` to `MuralRow` (after `share_token`) and `folderId: string | null;` to `Mural` (after `shareUrl`). Append the two new types:

```ts
export interface MuralFolderRow {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MuralFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: Extend the MuralsRepository port**

In `backend/src/modules/murals/domain/ports.ts`: change the `update` patch type to

```ts
  update(
    id: string,
    userId: string,
    patch: Partial<Pick<MuralRow, "name" | "blocks" | "cover_image_id" | "cover_image_url" | "folder_id">>
  ): MuralRow | undefined;
```

and append these methods to the `MuralsRepository` interface (import `MuralFolderRow` from `./types.js` alongside `MuralRow`):

```ts
  listFoldersByUser(userId: string): MuralFolderRow[];
  getOwnedFolder(id: string, userId: string): MuralFolderRow | undefined;
  insertFolder(row: MuralFolderRow): void;
  updateFolder(
    id: string,
    userId: string,
    patch: Partial<Pick<MuralFolderRow, "name" | "parent_id">>
  ): MuralFolderRow | undefined;
  reparentFolderChildren(folderId: string, userId: string, parentId: string | null): void;
  deleteFolder(id: string, userId: string): boolean;
```

- [ ] **Step 5: Implement the new repo methods in sqliteMuralsRepository.ts**

In `backend/src/modules/murals/adapters/sqlite/sqliteMuralsRepository.ts`:

Change the murals `insertStmt` to include the new column:

```ts
  const insertStmt = db.prepare(`
    INSERT INTO murals (id, user_id, name, blocks, cover_image_id, cover_image_url, share_token, folder_id, created_at, updated_at)
    VALUES ($id, $user_id, $name, $blocks, $cover_image_id, $cover_image_url, $share_token, $folder_id, $created_at, $updated_at)
  `);
```

Change `updateStmt` to set the column:

```ts
  const updateStmt = db.prepare(`
    UPDATE murals
    SET name = $name, blocks = $blocks, cover_image_id = $cover_image_id, cover_image_url = $cover_image_url, folder_id = $folder_id, updated_at = $updated_at
    WHERE id = $id AND user_id = $user_id
  `);
```

Add folder statements after `getByShareTokenStmt`:

```ts
  const insertFolderStmt = db.prepare(`
    INSERT INTO mural_folders (id, user_id, name, parent_id, created_at, updated_at)
    VALUES ($id, $user_id, $name, $parent_id, $created_at, $updated_at)
  `);
  const listFoldersStmt = db.prepare(`SELECT * FROM mural_folders WHERE user_id = ? ORDER BY created_at ASC`);
  const getOwnedFolderStmt = db.prepare(`SELECT * FROM mural_folders WHERE id = ? AND user_id = ?`);
  const updateFolderStmt = db.prepare(`
    UPDATE mural_folders
    SET name = $name, parent_id = $parent_id, updated_at = $updated_at
    WHERE id = $id AND user_id = $user_id
  `);
  const reparentChildFoldersStmt = db.prepare(`
    UPDATE mural_folders SET parent_id = $parent_id, updated_at = $updated_at
    WHERE parent_id = $folder_id AND user_id = $user_id
  `);
  const reparentChildMuralsStmt = db.prepare(`
    UPDATE murals SET folder_id = $folder_id, updated_at = $updated_at
    WHERE folder_id = $old_folder_id AND user_id = $user_id
  `);
  const deleteFolderStmt = db.prepare(`DELETE FROM mural_folders WHERE id = ? AND user_id = ?`);
```

In the returned object: pass `$folder_id: row.folder_id` in `insert`, pass `$folder_id: merged.folder_id` in `update`, and add the six methods:

```ts
    listFoldersByUser(userId) {
      return listFoldersStmt.all(userId) as unknown as MuralFolderRow[];
    },

    getOwnedFolder(id, userId) {
      return getOwnedFolderStmt.get(id, userId) as MuralFolderRow | undefined;
    },

    insertFolder(row) {
      insertFolderStmt.run({
        $id: row.id,
        $user_id: row.user_id,
        $name: row.name,
        $parent_id: row.parent_id,
        $created_at: row.created_at,
        $updated_at: row.updated_at
      });
    },

    updateFolder(id, userId, patch) {
      const existing = getOwnedFolderStmt.get(id, userId) as MuralFolderRow | undefined;
      if (!existing) return undefined;
      const updatedAt = new Date().toISOString();
      const merged: MuralFolderRow = { ...existing, ...patch, updated_at: updatedAt };
      updateFolderStmt.run({
        $id: id,
        $user_id: userId,
        $name: merged.name,
        $parent_id: merged.parent_id,
        $updated_at: updatedAt
      });
      return merged;
    },

    reparentFolderChildren(folderId, userId, parentId) {
      const updatedAt = new Date().toISOString();
      reparentChildFoldersStmt.run({ $folder_id: folderId, $user_id: userId, $parent_id: parentId, $updated_at: updatedAt });
      reparentChildMuralsStmt.run({ $old_folder_id: folderId, $user_id: userId, $folder_id: parentId, $updated_at: updatedAt });
    },

    deleteFolder(id, userId) {
      const result = deleteFolderStmt.run(id, userId);
      return result.changes > 0;
    }
```

Import `MuralFolderRow` alongside `MuralRow` in the type import at the top.

- [ ] **Step 6: Typecheck**

Run: `cd backend && npm run typecheck`
Expected: errors ONLY in `service.ts` (missing `folder_id` in the `createMural` row literal and missing new methods on the returned service object) and possibly `migration.ts` — Task 2 fixes service.ts. If typecheck reports the repo/port/types files themselves clean, the storage layer is consistent. Do not fix service.ts here.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/murals
git commit -m "murals: mural_folders table, folder_id column, repository"
```

---

### Task 2: Backend service — folder operations, mural moves, typed errors, tests

**Files:**
- Modify: `backend/src/modules/murals/domain/errors.ts`
- Modify: `backend/src/modules/murals/service.ts`
- Create: `backend/src/modules/murals/service.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: the extended `MuralsRepository` from Task 1.
- Produces: `MuralsService` extended with `listFolders(userId: string): MuralFolder[]`, `createFolder(userId: string, name: string, parentId?: string | null): MuralFolder`, `renameFolder(userId: string, id: string, name: string): MuralFolder | undefined`, `moveFolder(userId: string, id: string, parentId: string | null): MuralFolder | undefined`, `deleteFolder(userId: string, id: string): boolean`; `createMural(userId, name, folderId?: string | null)`; `updateMural` patch gains `folderId?: string | null`. Errors `InvalidFolderReferenceError`, `FolderCycleError` (both `Error` subclasses). `Mural` DTO now carries `folderId`.

- [ ] **Step 1: Replace the placeholder errors.ts**

Replace the entire contents of `backend/src/modules/murals/domain/errors.ts` (it is currently a comments-only placeholder) with plain `Error` subclasses — no shared base class, matching this module's existing convention:

```ts
export class InvalidFolderReferenceError extends Error {
  constructor() {
    super("That folder doesn't exist.");
    this.name = "InvalidFolderReferenceError";
  }
}

export class FolderCycleError extends Error {
  constructor() {
    super("A folder can't be moved into itself or one of its own subfolders.");
    this.name = "FolderCycleError";
  }
}
```

- [ ] **Step 2: Add the murals test file to npm test**

In `backend/package.json`, change:

```json
    "test": "tsx --test src/modules/arena/service.test.ts src/modules/murals/service.test.ts",
```

- [ ] **Step 3: Write the failing tests**

Create `backend/src/modules/murals/service.test.ts` with exactly:

```ts
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
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd backend && npm test`
Expected: FAIL — the murals service has no `createFolder`/`listFolders`/`moveFolder` etc. (TypeError: service.createFolder is not a function), and `service.test.ts` also fails type-loading if `errors.ts` exports don't exist yet. Arena's tests still pass.

- [ ] **Step 5: Implement the service changes**

In `backend/src/modules/murals/service.ts`:

Add imports:

```ts
import { FolderCycleError, InvalidFolderReferenceError } from "./domain/errors.js";
import type { MuralFolder, MuralFolderRow } from "./domain/types.js";
```

Change `toMural` to map the new field (add after `shareUrl`):

```ts
    folderId: row.folder_id,
```

Add a folder mapper above `MuralsService`:

```ts
function toFolder(row: MuralFolderRow): MuralFolder {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
```

Extend the `MuralsService` interface: change

```ts
  createMural(userId: string, name: string): Mural;
```

to

```ts
  createMural(userId: string, name: string, folderId?: string | null): Mural;
```

change `updateMural`'s patch type to

```ts
  updateMural(userId: string, id: string, patch: { name?: string; blocks?: unknown[]; folderId?: string | null }): Mural | undefined;
```

and append to the interface (before `getRowByShareToken`):

```ts
  listFolders(userId: string): MuralFolder[];
  createFolder(userId: string, name: string, parentId?: string | null): MuralFolder;
  renameFolder(userId: string, id: string, name: string): MuralFolder | undefined;
  moveFolder(userId: string, id: string, parentId: string | null): MuralFolder | undefined;
  deleteFolder(userId: string, id: string): boolean;
```

In `createMuralsService`: change `createMural` to

```ts
    createMural(userId, name, folderId = null) {
      if (folderId !== null && !repo.getOwnedFolder(folderId, userId)) throw new InvalidFolderReferenceError();
      const now = new Date().toISOString();
      const row: MuralRow = {
        id: randomUUID(),
        user_id: userId,
        name,
        blocks: "[]",
        cover_image_id: null,
        cover_image_url: null,
        share_token: null,
        folder_id: folderId,
        created_at: now,
        updated_at: now
      };
      repo.insert(row);
      return toMural(row, publicUrlFor);
    },
```

change `updateMural` to

```ts
    updateMural(userId, id, patch) {
      if (patch.folderId !== undefined && patch.folderId !== null && !repo.getOwnedFolder(patch.folderId, userId)) {
        throw new InvalidFolderReferenceError();
      }
      const row = repo.update(id, userId, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.blocks !== undefined ? { blocks: JSON.stringify(patch.blocks) } : {}),
        ...(patch.folderId !== undefined ? { folder_id: patch.folderId } : {})
      });
      return row ? toMural(row, publicUrlFor) : undefined;
    },
```

and add the folder operations before `getRowByShareToken`:

```ts
    listFolders(userId) {
      return repo.listFoldersByUser(userId).map(toFolder);
    },

    createFolder(userId, name, parentId = null) {
      if (parentId !== null && !repo.getOwnedFolder(parentId, userId)) throw new InvalidFolderReferenceError();
      const now = new Date().toISOString();
      const row: MuralFolderRow = {
        id: randomUUID(),
        user_id: userId,
        name,
        parent_id: parentId,
        created_at: now,
        updated_at: now
      };
      repo.insertFolder(row);
      return toFolder(row);
    },

    renameFolder(userId, id, name) {
      const row = repo.updateFolder(id, userId, { name });
      return row ? toFolder(row) : undefined;
    },

    moveFolder(userId, id, parentId) {
      const existing = repo.getOwnedFolder(id, userId);
      if (!existing) return undefined;
      if (parentId !== null) {
        if (parentId === id) throw new FolderCycleError();
        if (!repo.getOwnedFolder(parentId, userId)) throw new InvalidFolderReferenceError();
        const all = repo.listFoldersByUser(userId);
        const byId = new Map(all.map((f) => [f.id, f]));
        let current: string | null = byId.get(parentId)?.parent_id ?? null;
        while (current !== null) {
          if (current === id) throw new FolderCycleError();
          current = byId.get(current)?.parent_id ?? null;
        }
      }
      const row = repo.updateFolder(id, userId, { parent_id: parentId });
      return row ? toFolder(row) : undefined;
    },

    deleteFolder(userId, id) {
      const existing = repo.getOwnedFolder(id, userId);
      if (!existing) return false;
      repo.reparentFolderChildren(id, userId, existing.parent_id);
      return repo.deleteFolder(id, userId);
    },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && npm test`
Expected: PASS — all arena tests plus the 14 murals tests.

- [ ] **Step 7: Typecheck**

Run: `cd backend && npm run typecheck`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/murals backend/package.json
git commit -m "murals: folder service operations, mural moves, typed errors, tests"
```

---

### Task 3: Backend routes + README

**Files:**
- Modify: `backend/src/modules/murals/routes.ts`
- Modify: `backend/README.md`

**Interfaces:**
- Consumes: `MuralsService` from Task 2 (`listFolders`, `createFolder`, `renameFolder`, `moveFolder`, `deleteFolder`; `createMural`/`updateMural` with `folderId`), `InvalidFolderReferenceError`, `FolderCycleError`.
- Produces: REST endpoints `GET /murals/folders` → `{folders}`, `POST /murals/folders` `{name, parentId?}` → 201, `PUT /murals/folders/:id` `{name? | parentId?}` → folder, `DELETE /murals/folders/:id` → 204; `POST /murals` and `PUT /murals/:id` now accept `folderId`.

- [ ] **Step 1: Extend the mural zod schemas**

In `backend/src/modules/murals/routes.ts`, change `createMuralSchema` to

```ts
const createMuralSchema = z.object({
  name: z.string().min(1, "name is required and must be non-empty."),
  folderId: z.string().uuid().nullable().optional()
});
```

and `updateMuralSchema` to

```ts
const updateMuralSchema = z
  .object({
    name: z.string().min(1).optional(),
    blocks: z.array(z.unknown()).optional(),
    folderId: z.string().uuid().nullable().optional()
  })
  .refine((body) => body.name !== undefined || body.blocks !== undefined || body.folderId !== undefined, {
    message: "At least one of name, blocks, or folderId must be provided."
  });
```

Add folder schemas after `setCoverSchema`:

```ts
const createFolderSchema = z.object({
  name: z.string().min(1, "name is required and must be non-empty."),
  parentId: z.string().uuid().nullable().optional()
});

const updateFolderSchema = z
  .object({
    name: z.string().min(1).optional(),
    parentId: z.string().uuid().nullable().optional()
  })
  .refine((body) => body.name !== undefined || body.parentId !== undefined, {
    message: "At least one of name or parentId must be provided."
  });
```

- [ ] **Step 2: Thread folderId through the mural routes**

Import the errors at the top:

```ts
import { FolderCycleError, InvalidFolderReferenceError } from "./domain/errors.js";
```

Change the `POST /murals` handler body to

```ts
      const parsed = createMuralSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      }
      try {
        const mural = service.createMural(request.user.id, parsed.data.name, parsed.data.folderId ?? null);
        return reply.code(201).send(mural);
      } catch (err) {
        if (err instanceof InvalidFolderReferenceError) return reply.code(400).send({ error: err.message });
        throw err;
      }
```

Change the `PUT /murals/:id` handler's service call to

```ts
      try {
        const mural = service.updateMural(request.user.id, params.data.id, body.data);
        if (!mural) {
          return reply.code(404).send({ error: "No mural with that id." });
        }
        return reply.send(mural);
      } catch (err) {
        if (err instanceof InvalidFolderReferenceError) return reply.code(400).send({ error: err.message });
        throw err;
      }
```

- [ ] **Step 3: Add the folder routes**

Inside `buildMuralRoutes`'s returned function, after the `POST /murals/:id/unshare` route (last one), add:

```ts
    app.get("/murals/folders", { preHandler: authGuard }, async (request, reply) => {
      return reply.send({ folders: service.listFolders(request.user.id) });
    });

    app.post("/murals/folders", { preHandler: authGuard }, async (request, reply) => {
      const parsed = createFolderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      }
      try {
        const folder = service.createFolder(request.user.id, parsed.data.name, parsed.data.parentId ?? null);
        return reply.code(201).send(folder);
      } catch (err) {
        if (err instanceof InvalidFolderReferenceError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    });

    app.put("/murals/folders/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid folder id." });
      }
      const body = updateFolderSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.issues[0]?.message ?? "Invalid request." });
      }
      let folder;
      try {
        if (body.data.name !== undefined) {
          folder = service.renameFolder(request.user.id, params.data.id, body.data.name);
        }
        if (body.data.parentId !== undefined) {
          folder = service.moveFolder(request.user.id, params.data.id, body.data.parentId);
        }
      } catch (err) {
        if (err instanceof InvalidFolderReferenceError || err instanceof FolderCycleError) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
      if (!folder) {
        return reply.code(404).send({ error: "No folder with that id." });
      }
      return reply.send(folder);
    });

    app.delete("/murals/folders/:id", { preHandler: authGuard }, async (request, reply) => {
      const params = idParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: "Invalid folder id." });
      }
      const deleted = service.deleteFolder(request.user.id, params.data.id);
      if (!deleted) {
        return reply.code(404).send({ error: "No folder with that id." });
      }
      return reply.code(204).send();
    });
```

- [ ] **Step 4: Typecheck and test**

Run: `cd backend && npm run typecheck && npm test`
Expected: both clean/pass.

- [ ] **Step 5: Boot the server twice to verify the migration on the real DB**

Run: `cd backend && timeout 10 npm run dev; timeout 10 npm run dev`
Expected: both boots start with no SQL error about `folder_id`/`mural_folders` (the second boot exercises the "column already exists" path). Ignore the timeout kill.

- [ ] **Step 6: Update backend/README.md**

In the `murals` module section: add a bullet describing folder support, and add these rows to the module's endpoint table (find the `### \`murals\`` routes table; insert after the existing murals rows):

```markdown
| GET | `/murals/folders` | ✓ | `{folders: MuralFolder[]}` for the caller's account |
| POST | `/murals/folders` | ✓ | `{name, parentId?}` → `{muralFolder}`, `201` (400 if parentId isn't yours) |
| PUT | `/murals/folders/:id` | ✓ | `{name? \| parentId?}` at least one (`parentId: null` = root) → `{muralFolder}` (400 on cycle) |
| DELETE | `/murals/folders/:id` | ✓ | children/murals splice up one level → `204`, or `404` |
```

Also extend the module bullet list with:

```markdown
- **Nested mural folders** — a `mural_folders` adjacency list (`parent_id`) plus a nullable `folder_id` on each mural. Deleting a folder splices its children and murals up one level (never deletes content); moving a folder into itself/descendants is rejected. Folders never surface on the public share view.
```

Update the module table's murals row description (`all /murals* ✓ except GET /murals/shared/:token`) — it stays accurate as-is; no change needed there.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/murals/routes.ts backend/README.md
git commit -m "murals: folder routes + README"
```

---

### Task 4: Frontend data layer — types, tree helpers, API wrappers, hooks

**Files:**
- Modify: `frontend/src/lib/murals.ts`
- Create: `frontend/src/lib/muralFolders.ts`
- Modify: `frontend/src/api/murals.ts`
- Create: `frontend/src/hooks/useMuralFolders.ts`
- Modify: `frontend/src/hooks/useMurals.ts`
- Modify: `frontend/src/pages/SharedMuralPage.tsx`

**Interfaces:**
- Consumes: Task 3's REST endpoints.
- Produces: `MuralFolder` type (`lib/murals.ts`); `Mural.folderId: string | null`; `buildTree(folders: MuralFolder[]): FolderNode[]` where `FolderNode = {folder: MuralFolder; depth: number}`; `folderPath(folders: MuralFolder[], id: string | null): MuralFolder[]`; `collectSubtreeIds(folders: MuralFolder[], id: string): Set<string>` (includes `id` itself — this is the spec's `isDescendant`, realized as the set both callers need); API fns `fetchMuralFolders`, `createMuralFolderApi(name, parentId?)`, `updateMuralFolderApi(id, patch)`, `deleteMuralFolderApi(id)`; `useMuralFolders()` → `{...useQuery result, create, rename, move, remove}`; `useMurals()` gains `create(name, folderId?)` overload arg and `move(id, folderId: string | null)`.

- [ ] **Step 1: Extend lib/murals.ts**

Add `folderId: string | null;` to the `Mural` interface (after `shareUrl`), and append the folder type at the end of the file:

```ts
export interface MuralFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Create lib/muralFolders.ts**

```ts
import type { MuralFolder } from "./murals";

export interface FolderNode {
  folder: MuralFolder;
  depth: number;
}

export function buildTree(folders: MuralFolder[]): FolderNode[] {
  const byParent = new Map<string | null, MuralFolder[]>();
  for (const folder of folders) {
    const siblings = byParent.get(folder.parentId) ?? [];
    siblings.push(folder);
    byParent.set(folder.parentId, siblings);
  }
  const out: FolderNode[] = [];
  function walk(parentId: string | null, depth: number) {
    for (const folder of byParent.get(parentId) ?? []) {
      out.push({ folder, depth });
      walk(folder.id, depth + 1);
    }
  }
  walk(null, 0);
  return out;
}

export function folderPath(folders: MuralFolder[], id: string | null): MuralFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: MuralFolder[] = [];
  let current = id === null ? null : (byId.get(id) ?? null);
  while (current) {
    path.unshift(current);
    current = current.parentId === null ? null : (byId.get(current.parentId) ?? null);
  }
  return path;
}

export function collectSubtreeIds(folders: MuralFolder[], id: string): Set<string> {
  const ids = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId !== null && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        grew = true;
      }
    }
  }
  return ids;
}
```

- [ ] **Step 3: Extend api/murals.ts**

Change the import to include `MuralFolder`:

```ts
import type { Mural, MuralBlock, MuralFolder } from "../lib/murals";
```

Change `createMuralApi` and `updateMuralApi`:

```ts
export async function createMuralApi(name: string, folderId: string | null = null): Promise<Mural> {
  return (await apiFetch("/murals", { method: "POST", body: JSON.stringify({ name, folderId }) })) as Mural;
}

export async function updateMuralApi(id: string, patch: { name?: string; blocks?: MuralBlock[]; folderId?: string | null }): Promise<Mural> {
  return (await apiFetch(`/murals/${id}`, { method: "PUT", body: JSON.stringify(patch) })) as Mural;
}
```

Append folder wrappers:

```ts
export async function fetchMuralFolders(): Promise<MuralFolder[]> {
  const body = (await apiFetch("/murals/folders")) as { folders: MuralFolder[] };
  return body.folders;
}

export async function createMuralFolderApi(name: string, parentId: string | null = null): Promise<MuralFolder> {
  return (await apiFetch("/murals/folders", { method: "POST", body: JSON.stringify({ name, parentId }) })) as MuralFolder;
}

export async function updateMuralFolderApi(id: string, patch: { name?: string; parentId?: string | null }): Promise<MuralFolder> {
  return (await apiFetch(`/murals/folders/${id}`, { method: "PUT", body: JSON.stringify(patch) })) as MuralFolder;
}

export async function deleteMuralFolderApi(id: string): Promise<void> {
  await apiFetch(`/murals/folders/${id}`, { method: "DELETE" });
}
```

- [ ] **Step 4: Create hooks/useMuralFolders.ts**

```ts
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createMuralFolderApi, deleteMuralFolderApi, fetchMuralFolders, updateMuralFolderApi } from "../api/murals";
import type { Mural, MuralFolder } from "../lib/murals";

export function useMuralFolders() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["muralFolders"], queryFn: fetchMuralFolders });

  function current(): MuralFolder[] {
    return queryClient.getQueryData<MuralFolder[]>(["muralFolders"]) ?? [];
  }

  function setFolders(folders: MuralFolder[]) {
    queryClient.setQueryData(["muralFolders"], folders);
  }

  function replaceOne(updated: MuralFolder) {
    setFolders(current().map((f) => (f.id === updated.id ? updated : f)));
  }

  async function create(name: string, parentId: string | null = null): Promise<MuralFolder> {
    const created = await createMuralFolderApi(name, parentId);
    setFolders([...current(), created]);
    return created;
  }

  async function rename(id: string, name: string): Promise<MuralFolder> {
    const updated = await updateMuralFolderApi(id, { name });
    replaceOne(updated);
    return updated;
  }

  async function move(id: string, parentId: string | null): Promise<MuralFolder> {
    const updated = await updateMuralFolderApi(id, { parentId });
    replaceOne(updated);
    return updated;
  }

  async function remove(id: string): Promise<void> {
    await deleteMuralFolderApi(id);
    const parentId = current().find((f) => f.id === id)?.parentId ?? null;
    setFolders(
      current()
        .filter((f) => f.id !== id)
        .map((f) => (f.parentId === id ? { ...f, parentId } : f))
    );
    const murals = queryClient.getQueryData<Mural[]>(["murals"]);
    if (murals) {
      queryClient.setQueryData(
        ["murals"],
        murals.map((m) => ((m.folderId ?? null) === id ? { ...m, folderId: parentId } : m))
      );
    }
  }

  return { ...query, create, rename, move, remove };
}
```

- [ ] **Step 5: Extend hooks/useMurals.ts**

Change `create` and add `move` (keep everything else identical):

```ts
  async function create(name: string, folderId: string | null = null): Promise<Mural> {
    const created = await createMuralApi(name, folderId);
    setMurals([...current(), created]);
    return created;
  }
```

```ts
  async function move(id: string, folderId: string | null): Promise<Mural> {
    const updated = await updateMuralApi(id, { folderId });
    replaceOne(updated);
    return updated;
  }
```

Add `move` to the returned object:

```ts
  return { ...query, create, rename, saveBlocks, remove, setCover, clearCover, share, unshare, move, scrubBooks, scrubImage };
```

- [ ] **Step 6: Fix SharedMuralPage's stand-in Mural**

In `frontend/src/pages/SharedMuralPage.tsx`, add `folderId: null,` to the `const mural: Mural = {…}` literal (after `shareUrl: null`).

- [ ] **Step 7: Typecheck and lint**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add frontend/src
git commit -m "frontend: mural folder data layer (types, tree helpers, api, hooks)"
```

---

### Task 5: Frontend components — MuralFolderTree + MoveToFolderModal

**Files:**
- Create: `frontend/src/components/murals/MuralFolderTree.tsx`
- Create: `frontend/src/components/murals/MoveToFolderModal.tsx`

**Interfaces:**
- Consumes: `buildTree`, `folderPath` from `lib/muralFolders.ts`; `MuralFolder` from `lib/murals.ts`; `OptionsMenu` from `components/OptionsMenu.tsx`.
- Produces: `MuralFolderTree` props `{folders: MuralFolder[]; selectedFolderId: string | null; onSelect: (folderId: string | null) => void; onCreateFolder: (parentId: string | null) => void; onRenameFolder: (folder: MuralFolder, name: string) => void; onMoveFolder: (folder: MuralFolder) => void; onDeleteFolder: (folder: MuralFolder) => void}`; `MoveToFolderModal` props `{title: string; folders: MuralFolder[]; disabledIds: Set<string>; onSelect: (folderId: string | null) => void; onClose: () => void}`.

- [ ] **Step 1: Create MuralFolderTree.tsx**

```tsx
import { useState } from "react";
import { buildTree, folderPath } from "../../lib/muralFolders";
import type { MuralFolder } from "../../lib/murals";
import { OptionsMenu } from "../OptionsMenu";

export function MuralFolderTree({
  folders,
  selectedFolderId,
  onSelect,
  onCreateFolder,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder
}: {
  folders: MuralFolder[];
  selectedFolderId: string | null;
  onSelect: (folderId: string | null) => void;
  onCreateFolder: (parentId: string | null) => void;
  onRenameFolder: (folder: MuralFolder, name: string) => void;
  onMoveFolder: (folder: MuralFolder) => void;
  onDeleteFolder: (folder: MuralFolder) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function commitRename(folder: MuralFolder) {
    setRenamingId(null);
    const name = renameDraft.trim();
    if (name && name !== folder.name) onRenameFolder(folder, name);
  }

  return (
    <nav className="flex flex-col gap-0.5">
      <button
        onClick={() => onSelect(null)}
        className={`rounded-lg px-2 py-1.5 text-left text-sm font-semibold ${
          selectedFolderId === null
            ? "bg-(--color-accent-soft) text-(--color-accent)"
            : "text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
        }`}
      >
        All murals
      </button>

      {buildTree(folders)
        .filter(({ folder }) => !folderPath(folders, folder.id).slice(0, -1).some((p) => collapsed.has(p.id)))
        .map(({ folder, depth }) => {
          const hasChildren = folders.some((f) => f.parentId === folder.id);
          const isCollapsed = collapsed.has(folder.id);
          return (
            <div key={folder.id} className="group flex items-center gap-0.5" style={{ paddingLeft: depth * 14 }}>
              <button
                onClick={() => toggle(folder.id)}
                title={isCollapsed ? "Expand" : "Collapse"}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-(--color-text-dim) hover:bg-(--color-surface-hover) ${
                  hasChildren ? "" : "invisible"
                }`}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={isCollapsed ? "" : "rotate-90"}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
              {renamingId === folder.id ? (
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => commitRename(folder)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(folder);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  className="w-full min-w-0 rounded border border-(--color-border) bg-(--color-surface) px-1.5 py-0.5 text-sm"
                />
              ) : (
                <button
                  onClick={() => onSelect(folder.id)}
                  className={`flex-1 truncate rounded px-1.5 py-1 text-left text-sm ${
                    selectedFolderId === folder.id
                      ? "bg-(--color-accent-soft) font-semibold text-(--color-accent)"
                      : "text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
                  }`}
                >
                  {folder.name}
                </button>
              )}
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => onCreateFolder(folder.id)}
                  title="New subfolder"
                  className="flex h-5 w-5 items-center justify-center rounded text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
                <OptionsMenu
                  title="Folder settings"
                  triggerClassName="flex h-5 w-5 items-center justify-center rounded text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
                  items={[
                    {
                      label: "Rename",
                      onClick: () => {
                        setRenamingId(folder.id);
                        setRenameDraft(folder.name);
                      }
                    },
                    { label: "Move to…", onClick: () => onMoveFolder(folder) },
                    { label: "Delete", onClick: () => onDeleteFolder(folder), danger: true }
                  ]}
                />
              </div>
            </div>
          );
        })}

      <button
        onClick={() => onCreateFolder(selectedFolderId)}
        className="mt-2 rounded-lg border border-dashed border-(--color-border) px-2 py-1.5 text-left text-xs text-(--color-text-dim) transition-colors hover:border-(--color-accent) hover:text-(--color-accent)"
      >
        + New folder
      </button>
    </nav>
  );
}
```

- [ ] **Step 2: Create MoveToFolderModal.tsx**

```tsx
import { buildTree } from "../../lib/muralFolders";
import type { MuralFolder } from "../../lib/murals";

export function MoveToFolderModal({
  title,
  folders,
  disabledIds,
  onSelect,
  onClose
}: {
  title: string;
  folders: MuralFolder[];
  disabledIds: Set<string>;
  onSelect: (folderId: string | null) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-xl border border-(--color-border) bg-(--color-surface) shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-(--color-border) p-4">
          <h3 className="text-sm font-semibold">Move "{title}"</h3>
          <button onClick={onClose} className="text-sm text-(--color-text-dim) hover:text-(--color-text)">
            Close
          </button>
        </div>
        <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto p-3">
          <button
            onClick={() => onSelect(null)}
            className="rounded-lg px-2 py-1.5 text-left text-sm text-(--color-text) hover:bg-(--color-surface-hover)"
          >
            All murals (root)
          </button>
          {buildTree(folders).map(({ folder, depth }) => {
            const disabled = disabledIds.has(folder.id);
            return (
              <button
                key={folder.id}
                disabled={disabled}
                onClick={() => onSelect(folder.id)}
                style={{ marginLeft: (depth + 1) * 14 }}
                className={`truncate rounded-lg px-2 py-1.5 text-left text-sm ${
                  disabled
                    ? "cursor-not-allowed text-(--color-text-dim) opacity-40"
                    : "text-(--color-text) hover:bg-(--color-surface-hover)"
                }`}
              >
                {folder.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: clean (unused-new-file warnings are not a thing in this setup; the components get consumed in Task 6).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/murals
git commit -m "frontend: MuralFolderTree + MoveToFolderModal"
```

---

### Task 6: Frontend page — MuralsListPage split view

**Files:**
- Modify: `frontend/src/pages/MuralsListPage.tsx`

**Interfaces:**
- Consumes: `MuralFolderTree` + `MoveToFolderModal` (Task 5 props), `useMuralFolders` + extended `useMurals` (Task 4), `folderPath`, `buildTree`, `collectSubtreeIds` from `lib/muralFolders.ts`, `MuralFolder` type.
- Produces: the reworked `/dashboard/murals` page.

- [ ] **Step 1: Update imports**

Add to the existing imports in `MuralsListPage.tsx`:

```tsx
import { MoveToFolderModal } from "../components/murals/MoveToFolderModal";
import { MuralFolderTree } from "../components/murals/MuralFolderTree";
import { useMuralFolders } from "../hooks/useMuralFolders";
import { buildTree, collectSubtreeIds, folderPath } from "../lib/muralFolders";
```

Change the `Mural` type import line to also import `MuralFolder`:

```tsx
import type { Mural, MuralFolder } from "../lib/murals";
```

- [ ] **Step 2: Add folders hook + page state**

After the existing `useMurals()` line add:

```tsx
  const { data: foldersData, create: createFolder, rename: renameFolder, move: moveFolderApi, remove: removeFolder } = useMuralFolders();
  const folders = foldersData ?? [];
```

Extend the `useMurals()` destructure to include `move: moveMural`.

Add state next to the existing `useState` block:

```tsx
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [movingMuralId, setMovingMuralId] = useState<string | null>(null);
  const [movingFolderId, setMovingFolderId] = useState<string | null>(null);
```

- [ ] **Step 3: Change the mural filter to folder + global-search logic**

Replace the `filteredMurals` computation (the block from `const needle = ...` through the `.sort(...)` line) with:

```tsx
  const needle = search.trim().toLowerCase();
  const sortField = sortBy.startsWith("created") ? "createdAt" : "updatedAt";
  const sortDirection = sortBy.endsWith("Desc") ? -1 : 1;
  const candidateMurals = needle
    ? murals.filter((m) => m.name.toLowerCase().includes(needle))
    : murals.filter((m) => (m.folderId ?? null) === selectedFolderId);
  const filteredMurals = [...candidateMurals].sort(
    (a, b) => (new Date(a[sortField]).getTime() - new Date(b[sortField]).getTime()) * sortDirection
  );
```

- [ ] **Step 4: Update handlers**

Change `handleCreate` to create inside the selected folder:

```tsx
      const created = await create("Untitled mural", selectedFolderId);
```

Add these handlers after `handleDelete`:

```tsx
  async function handleDeleteFolder(folder: MuralFolder) {
    if (!(await confirm({ title: `Delete "${folder.name}"?`, body: "Murals and subfolders inside it move up one level. Nothing is deleted." }))) return;
    await removeFolder(folder.id);
    if (selectedFolderId === folder.id) setSelectedFolderId(folder.parentId);
  }
```

Add the moving-modal lookups near the existing `coverMural`/`sharingMural` lines:

```tsx
  const movingMural = movingMuralId ? murals.find((m) => m.id === movingMuralId) : null;
  const movingFolder = movingFolderId ? folders.find((f) => f.id === movingFolderId) : null;
```

- [ ] **Step 5: Add "Move to…" to each mural card's OptionsMenu**

In the card's `OptionsMenu` `items` array, insert before the `Share` item:

```tsx
                      { label: "Move to…", onClick: () => setMovingMuralId(mural.id) },
```

- [ ] **Step 6: Wrap the page body in the two-pane layout**

Replace the opening of the page body — the `<header className="mb-6 flex items-center justify-between gap-4">…</header>` stays at full width above; wrap everything from the search/sort controls `<div className="mb-4 flex flex-wrap items-end gap-3">…` down through the closing `</div>` of the card grid in:

```tsx
      <div className="flex items-start gap-6">
        <div className="hidden w-56 shrink-0 md:block">
          <MuralFolderTree
            folders={folders}
            selectedFolderId={selectedFolderId}
            onSelect={setSelectedFolderId}
            onCreateFolder={(parentId) => void createFolder("New folder", parentId)}
            onRenameFolder={(folder, name) => void renameFolder(folder.id, name)}
            onMoveFolder={(folder) => setMovingFolderId(folder.id)}
            onDeleteFolder={(folder) => void handleDeleteFolder(folder)}
          />
        </div>

        <div className="min-w-0 flex-1">
          {/* breadcrumb + mobile folder select + existing controls/grid/empty states go here */}
        </div>
      </div>
```

Concretely: everything that currently sits between the `</header>` and the `{coverMural && (` modal block moves inside the inner `<div className="min-w-0 flex-1">`, in the same order, with two additions at its top:

```tsx
          <nav className="mb-3 hidden items-center gap-1 text-xs text-(--color-text-dim) md:flex">
            <button onClick={() => setSelectedFolderId(null)} className="hover:text-(--color-text)">
              All murals
            </button>
            {folderPath(folders, selectedFolderId).map((f, i, path) => (
              <span key={f.id} className="flex items-center gap-1">
                <span>/</span>
                {i === path.length - 1 ? (
                  <span className="font-semibold text-(--color-text)">{f.name}</span>
                ) : (
                  <button onClick={() => setSelectedFolderId(f.id)} className="hover:text-(--color-text)">
                    {f.name}
                  </button>
                )}
              </span>
            ))}
          </nav>

          <select
            value={selectedFolderId ?? ""}
            onChange={(e) => setSelectedFolderId(e.target.value || null)}
            className="mb-3 w-full max-w-xs rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm md:hidden"
          >
            <option value="">All murals</option>
            {buildTree(folders).map(({ folder }) => (
              <option key={folder.id} value={folder.id}>
                {folderPath(folders, folder.id).map((p) => p.name).join(" / ")}
              </option>
            ))}
          </select>
```

Also change the folder-empty case: after the existing `No murals match this filter.` conditional, add:

```tsx
      {!isLoading && needle === "" && murals.length > 0 && filteredMurals.length === 0 && selectedFolderId !== null && (
        <p className="text-sm text-(--color-text-dim)">No murals in this folder.</p>
      )}
```

(This goes inside the inner flex-1 div, next to the existing no-match message.)

- [ ] **Step 7: Render the two move modals**

Add before the `{coverMural && (` block:

```tsx
      {movingMural && (
        <MoveToFolderModal
          title={movingMural.name}
          folders={folders}
          disabledIds={new Set()}
          onSelect={(folderId) => {
            setMovingMuralId(null);
            if ((movingMural.folderId ?? null) !== folderId) void moveMural(movingMural.id, folderId);
          }}
          onClose={() => setMovingMuralId(null)}
        />
      )}

      {movingFolder && (
        <MoveToFolderModal
          title={movingFolder.name}
          folders={folders}
          disabledIds={collectSubtreeIds(folders, movingFolder.id)}
          onSelect={(folderId) => {
            setMovingFolderId(null);
            if (folderId !== movingFolder.parentId) void moveFolderApi(movingFolder.id, folderId);
          }}
          onClose={() => setMovingFolderId(null)}
        />
      )}
```

- [ ] **Step 8: Typecheck and lint**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 9: Browser walkthrough**

With `npm run dev` running in both `backend/` and `frontend/`, log in and on `/dashboard/murals` verify:
- "New folder" creates a folder in the selected folder; hover a folder row shows `+` and ⚙; chevron collapses/expands subfolders.
- Breadcrumb segments navigate; mobile width (devtools responsive) shows the folder `<select>` instead of the tree.
- `+ New mural` tile creates a mural that appears only in the selected folder.
- Mural card ⚙ → "Move to…" moves it (folder badge: grid updates immediately).
- Folder ⚙ → "Move to…" shows itself + descendants disabled.
- Deleting a folder with contents confirms, splices contents up, keeps selection sane.
- Search finds murals across all folders.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/pages/MuralsListPage.tsx
git commit -m "frontend: Murals page folder-tree split view"
```

---

### Task 7: Final verification + frontend README

**Files:**
- Modify: `frontend/README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: documentation + verified end state.

- [ ] **Step 1: Run every check**

```bash
cd backend && npm run typecheck && npm test
cd ../frontend && npm run typecheck && npm run lint
```

Expected: all clean/pass.

- [ ] **Step 2: Update frontend/README.md**

Read the README's Murals section, then add this paragraph at its end:

```markdown
**Mural folders** — nested, file-tree organization for the mural list: a left-panel folder tree on the Murals page (it collapses to a breadcrumb + folder dropdown below `md`), backed by the backend's `/murals/folders` routes (`mural_folders` adjacency list + `folder_id` on each mural). Moving a mural or folder goes through a "Move to…" picker (folders can't move into themselves/descendants); deleting a folder splices its contents up one level and never deletes a mural. New murals are created inside the selected folder; search always spans all folders.
```

- [ ] **Step 3: Commit**

```bash
git add frontend/README.md
git commit -m "docs: mural folders in frontend README"
```

---

## Self-Review Notes (already applied)

- Spec coverage: folders table/migration (T1), service rules incl. cycle guard + splice (T2), full API surface incl. `POST /murals` folderId (T3), data layer + tree helpers (T4), tree + picker modal (T5), split view/breadcrumb/mobile/global-search/create-in-folder/confirm (T6), docs + verification (T7). Spec's `isDescendant` helper is realized as `collectSubtreeIds` (the superset both call sites need); noted in T4's Interfaces.
- Type consistency: `MuralFolder`/`MuralFolderRow` field names, repo method names (`listFoldersByUser`, `getOwnedFolder`, `insertFolder`, `updateFolder`, `reparentFolderChildren`, `deleteFolder`), and service method names are identical across T1/T2/T3; frontend hook method names (`create`, `rename`, `move`, `remove`) match T6's usage.
- The spec's `PUT /murals/folders/:id` with both `name` and `parentId` present: Task 3's handler applies rename then move in one request (matches "at least one").
