import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

const scratch = mkdtempSync(join(tmpdir(), "arena-routes-test-"));
process.env.AUTH_DB_PATH ??= join(scratch, "auth.sqlite");
process.env.LIBRARY_DB_PATH ??= join(scratch, "library.sqlite");
process.env.GALLERY_DB_PATH ??= join(scratch, "gallery.sqlite");
process.env.COVERS_DB_PATH ??= join(scratch, "covers.sqlite");
process.env.JWT_ACCESS_SECRET ??= "a".repeat(64);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(64);

const { applyArenaMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteArenaRepository } = await import("./adapters/sqlite/sqliteArenaRepository.js");
const { createArenaService } = await import("./service.js");
const { buildArenaRoutes } = await import("./routes.js");

test("GET /arenas/public allows 30 requests a minute per caller", async () => {
  const db = new DatabaseSync(":memory:");
  applyArenaMigrations(db);
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildArenaRoutes(createArenaService(createSqliteArenaRepository(db))));
  const list = (headers: Record<string, string> = {}, remoteAddress = "203.0.113.7") =>
    app.inject({ method: "GET", url: "/arenas/public", headers, remoteAddress });
  for (let request = 1; request <= 30; request++) assert.equal((await list()).statusCode, 200);
  assert.equal((await list()).statusCode, 429);
  assert.equal((await list({}, "203.0.113.8")).statusCode, 200);
  assert.equal((await list({ authorization: "Bearer reader" })).statusCode, 200);
  await app.close();
});

async function arenaApp() {
  const db = new DatabaseSync(":memory:");
  applyArenaMigrations(db);
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildArenaRoutes(createArenaService(createSqliteArenaRepository(db))));
  const created = await app.inject({
    method: "POST",
    url: "/arenas",
    headers: { authorization: "Bearer u1" },
    payload: { name: "Classics", bracketSize: 2, roundDurationMinutes: 60 }
  });
  assert.equal(created.statusCode, 201);
  return { app, db, id: created.json().tournament.id as string };
}

function putSlots(app: Awaited<ReturnType<typeof arenaApp>>["app"], id: string, books: Array<{ key: string; title: string; author: string }>) {
  return app.inject({
    method: "PUT",
    url: `/arenas/${id}/slots`,
    headers: { authorization: "Bearer u1" },
    payload: { slots: books.map((book, slotIndex) => ({ slotIndex, book: { ...book, cover: null } })) }
  });
}

test("PUT slots echoes keys and stores each slot's work", async () => {
  const { app, db, id } = await arenaApp();
  const keys = ["ta:dune|frank herbert", "ta:orlando|virginia woolf"];
  const res = await putSlots(app, id, [
    { key: keys[0]!, title: "Dune", author: "Frank Herbert" },
    { key: keys[1]!, title: "Orlando", author: "Virginia Woolf" }
  ]);
  assert.equal(res.statusCode, 204);
  const view = await app.inject({ method: "GET", url: `/arenas/${id}` });
  assert.equal(view.statusCode, 200);
  assert.deepEqual(view.json().tournament.slots.map((slot: { key: string }) => slot.key), keys);
  assert.doesNotMatch(view.body, /workId|work_id/);
  const rows = db.prepare("SELECT book_key, work_id FROM tournament_slots WHERE tournament_id = ? ORDER BY slot_index").all(id) as Array<{ book_key: string; work_id: string | null }>;
  assert.deepEqual(rows.map((row) => row.book_key), keys);
  for (const row of rows) assert.ok(row.work_id);
  await app.close();
});

test("PUT slots with two editions of one work is a 409 naming it", async () => {
  const { app, id } = await arenaApp();
  const res = await putSlots(app, id, [
    { key: "isbn:0441013597", title: "Dune", author: "Frank Herbert" },
    { key: "isbn:9780441013593", title: "Dune", author: "Frank Herbert" }
  ]);
  assert.equal(res.statusCode, 409);
  assert.match(res.json().error, /Dune/);
  await app.close();
});
