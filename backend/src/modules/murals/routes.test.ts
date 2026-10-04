import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratchDir = mkdtempSync(join(tmpdir(), "murals-routes-test-"));
process.env.AUTH_DB_PATH = join(scratchDir, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratchDir, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratchDir, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratchDir, "covers.sqlite");
process.env.MURALS_DB_PATH = join(scratchDir, "murals.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { createSqliteMuralsRepository } = await import("./adapters/sqlite/sqliteMuralsRepository.js");
const { createMuralsService } = await import("./service.js");
const { buildMuralRoutes } = await import("./routes.js");
const { openLibraryDb } = await import("../library/adapters/sqlite/connection.js");
const { applyBooksMigrations } = await import("../books/adapters/sqlite/connection.js");
const { WorkResolutionError } = await import("../library/index.js");

type Resolver = NonNullable<Parameters<typeof buildMuralRoutes>[1]>;

const DUNE_KEY = "ta:dune|frank herbert";

async function muralApp(resolveWorks?: Resolver) {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./adapters/sqlite/schema.sql", import.meta.url), "utf8"));
  const service = createMuralsService(createSqliteMuralsRepository(db), (token) => `https://app.test/shared/murals/${token}`, () => "dark");
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildMuralRoutes(service, resolveWorks));
  const putBlocks = (muralId: string, user: string, blocks: unknown[]) =>
    app.inject({ method: "PUT", url: `/murals/${muralId}`, headers: { authorization: `Bearer ${user}` }, payload: { blocks } });
  return { app, db, service, putBlocks };
}

function addLibraryBook(userId: string, position: number, bookKey: string, title: string, author: string) {
  const library = openLibraryDb();
  library.prepare("INSERT INTO library_books (user_id, position, book_key, title, author, isbn, row_hash) VALUES (?, ?, ?, ?, ?, NULL, 'h')").run(userId, position, bookKey, title, author);
  library.close();
}

function catalogBookCount(): number {
  const catalog = new DatabaseSync(process.env.COVERS_DB_PATH!);
  applyBooksMigrations(catalog);
  const { count } = catalog.prepare("SELECT COUNT(*) AS count FROM books").get() as { count: number };
  catalog.close();
  return count;
}

function workRows(db: DatabaseSync, muralId: string) {
  const rows = db.prepare("SELECT key, work_id FROM mural_works WHERE mural_id = ? ORDER BY key").all(muralId) as Array<{ key: string; work_id: string | null }>;
  return rows.map((row) => ({ ...row }));
}

const layout = { x: 0, y: 0, w: 12, h: 5 };

test("saving blocks echoes them byte-for-byte and stores works for their keys", async () => {
  addLibraryBook("u1", 0, DUNE_KEY, "Dune", "Frank Herbert");
  const { app, db, service, putBlocks } = await muralApp();
  const mural = service.createMural("u1", "Shelf");
  const blocks = [
    { id: "b1", type: "spotlight", layout, bookKey: DUNE_KEY },
    { id: "b2", type: "quote", layout, mode: "rediscover", bookKey: "" }
  ];

  const res = await putBlocks(mural.id, "u1", blocks);
  assert.equal(res.statusCode, 200);
  assert.deepEqual((res.json() as { blocks: unknown[] }).blocks, blocks);
  const rows = workRows(db, mural.id);
  assert.deepEqual(rows.map((row) => row.key), [DUNE_KEY]);
  assert.ok(rows[0]!.work_id);
  await app.close();
});

test("an unreachable catalog is a 503, stores nothing and leaves the blocks unchanged", async () => {
  const failing: Resolver = () => { throw new WorkResolutionError(new Error("down")); };
  const { app, db, service, putBlocks } = await muralApp(failing);
  const mural = service.createMural("u1", "Down");
  const before = [{ id: "b1", type: "spotlight", layout, bookKey: "old" }];
  assert.equal((await putBlocks(mural.id, "u1", before)).statusCode, 503);
  assert.deepEqual(service.getMural("u1", mural.id)!.blocks, []);
  assert.deepEqual(workRows(db, mural.id), []);
  await app.close();
});

test("a non-owner's save resolves nothing and a missing mural stays a 404", async () => {
  addLibraryBook("u3", 0, "ta:neuromancer|william gibson", "Neuromancer", "William Gibson");
  const { app, db, service, putBlocks } = await muralApp();
  const mural = service.createMural("u2", "Theirs");
  const blocks = [{ id: "b1", type: "spotlight", layout, bookKey: "ta:neuromancer|william gibson" }];

  const before = catalogBookCount();
  assert.equal((await putBlocks(mural.id, "u3", blocks)).statusCode, 404);
  assert.equal((await putBlocks("00000000-0000-4000-8000-000000000000", "u3", blocks)).statusCode, 404);
  assert.equal(catalogBookCount(), before);
  assert.deepEqual(workRows(db, mural.id), []);
  await app.close();
});

test("a stale save is a 409 and writes no works", async () => {
  addLibraryBook("u4", 0, DUNE_KEY, "Dune", "Frank Herbert");
  const { app, db, service } = await muralApp();
  const mural = service.createMural("u4", "Stale");
  const res = await app.inject({
    method: "PUT",
    url: `/murals/${mural.id}`,
    headers: { authorization: "Bearer u4" },
    payload: { blocks: [{ id: "b1", type: "spotlight", layout, bookKey: DUNE_KEY }], updatedAt: "2020-01-01T00:00:00.000Z" }
  });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(workRows(db, mural.id), []);
  await app.close();
});

test("a save with an unknown folder is a 400 that resolves nothing, even with the catalog down", async () => {
  addLibraryBook("u5", 0, "ta:hyperion|dan simmons", "Hyperion", "Dan Simmons");
  const { app, db, service } = await muralApp();
  const mural = service.createMural("u5", "Folder");
  const payload = { blocks: [{ id: "b1", type: "spotlight", layout, bookKey: "ta:hyperion|dan simmons" }], folderId: "00000000-0000-4000-8000-000000000000" };

  const before = catalogBookCount();
  const res = await app.inject({ method: "PUT", url: `/murals/${mural.id}`, headers: { authorization: "Bearer u5" }, payload });
  assert.equal(res.statusCode, 400);
  assert.equal(catalogBookCount(), before);
  assert.deepEqual(workRows(db, mural.id), []);
  await app.close();

  const failing: Resolver = () => { throw new WorkResolutionError(new Error("down")); };
  const down = await muralApp(failing);
  const other = down.service.createMural("u5", "Folder");
  const res503 = await down.app.inject({ method: "PUT", url: `/murals/${other.id}`, headers: { authorization: "Bearer u5" }, payload });
  assert.equal(res503.statusCode, 400);
  await down.app.close();
});

test("a save without blocks leaves the stored works alone", async () => {
  addLibraryBook("u6", 0, DUNE_KEY, "Dune", "Frank Herbert");
  const { app, db, service, putBlocks } = await muralApp();
  const mural = service.createMural("u6", "Rename");
  assert.equal((await putBlocks(mural.id, "u6", [{ id: "b1", type: "spotlight", layout, bookKey: DUNE_KEY }])).statusCode, 200);
  const stored = workRows(db, mural.id);
  assert.equal(stored.length, 1);

  const res = await app.inject({ method: "PUT", url: `/murals/${mural.id}`, headers: { authorization: "Bearer u6" }, payload: { name: "Renamed" } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(workRows(db, mural.id), stored);
  await app.close();
});
