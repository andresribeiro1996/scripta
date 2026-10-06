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
const { buildArenaRoutes, buildVoteRoute } = await import("./routes.js");
const { resolveWorks } = await import("../books/index.js");
const { openBooksDb } = await import("../books/adapters/sqlite/connection.js");
const { openLibraryDb } = await import("../library/adapters/sqlite/connection.js");

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

type ArenaRoutesResolver = NonNullable<Parameters<typeof buildArenaRoutes>[1]>;

async function arenaApp(resolveWorks?: ArenaRoutesResolver) {
  const db = new DatabaseSync(":memory:");
  applyArenaMigrations(db);
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildArenaRoutes(createArenaService(createSqliteArenaRepository(db)), resolveWorks));
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

test("PUT slots answers 503 and stores nothing when the catalog is unavailable", async () => {
  const { WorkResolutionError } = await import("../library/index.js");
  const { app, db, id } = await arenaApp(() => {
    throw new WorkResolutionError(new Error("catalog down"));
  });
  const res = await putSlots(app, id, [
    { key: "k1", title: "Dune", author: "Frank Herbert" },
    { key: "k2", title: "Orlando", author: "Virginia Woolf" }
  ]);
  assert.equal(res.statusCode, 503);
  assert.match(res.json().error, /catalog/i);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM tournament_slots WHERE tournament_id = ?").get(id) as { n: number }).n, 0);
  await app.close();
});

test("PUT slots by a non-owner is a 404, leaves the slots alone and writes nothing to the catalog", async () => {
  const { applyBooksMigrations } = await import("../books/adapters/sqlite/connection.js");
  const { app, db, id } = await arenaApp();
  const seeded = await putSlots(app, id, [
    { key: "ta:dune|frank herbert", title: "Dune", author: "Frank Herbert" },
    { key: "ta:orlando|virginia woolf", title: "Orlando", author: "Virginia Woolf" }
  ]);
  assert.equal(seeded.statusCode, 204);
  const slotsBefore = db.prepare("SELECT slot_index, book_key, title, work_id FROM tournament_slots WHERE tournament_id = ? ORDER BY slot_index").all(id);
  const res = await app.inject({
    method: "PUT",
    url: `/arenas/${id}/slots`,
    headers: { authorization: "Bearer u2" },
    payload: { slots: [{ slotIndex: 0, book: { key: "ta:zzyzx|nobody", title: "Zzyzx Road Atlas", author: "Nobody Atall", cover: null } }] }
  });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(db.prepare("SELECT slot_index, book_key, title, work_id FROM tournament_slots WHERE tournament_id = ? ORDER BY slot_index").all(id), slotsBefore);
  const catalog = new DatabaseSync(process.env.COVERS_DB_PATH!);
  applyBooksMigrations(catalog);
  assert.equal((catalog.prepare("SELECT COUNT(*) AS n FROM books WHERE title = ?").get("Zzyzx Road Atlas") as { n: number }).n, 0);
  catalog.close();
  await app.close();
});

test("GET /arenas/:id and /arenas/mine speak works with the header and keys without it", async () => {
  const { app, id } = await arenaApp();
  assert.equal((await putSlots(app, id, [
    { key: "ta:dune|frank herbert", title: "Dune", author: "Frank Herbert" },
    { key: "ta:orlando|virginia woolf", title: "Orlando", author: "Virginia Woolf" }
  ])).statusCode, 204);
  const works = await app.inject({ method: "GET", url: `/arenas/${id}`, headers: { "x-scripta-works": "1" } });
  assert.match(String(works.headers.vary), /X-Scripta-Works/);
  const slots = works.json().tournament.slots as Array<Record<string, unknown>>;
  assert.deepEqual(Object.keys(slots[0]!), ["slotIndex", "workId", "title", "author", "cover"]);
  assert.equal(typeof slots[0]!.workId, "string");
  const legacy = await app.inject({ method: "GET", url: `/arenas/${id}` });
  assert.deepEqual(Object.keys(legacy.json().tournament.slots[0]), ["slotIndex", "key", "title", "author", "cover"]);
  assert.doesNotMatch(legacy.body, /workId/);
  const mine = await app.inject({ method: "GET", url: "/arenas/mine", headers: { authorization: "Bearer u1", "x-scripta-works": "1" } });
  assert.equal(mine.json().tournaments[0].winner, null);
  await app.close();
});

function libraryCopy(userId: string, position: number, key: string, workId: string) {
  openLibraryDb().prepare("INSERT INTO library_books (user_id, position, book_key, title, author, row_hash, work_id) VALUES (?, ?, ?, 'T', 'A', 'h', ?)").run(userId, position, key, workId);
}

async function worksArena(owner: string) {
  const db = new DatabaseSync(":memory:");
  applyArenaMigrations(db);
  const service = createArenaService(createSqliteArenaRepository(db));
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildArenaRoutes(service));
  await app.register(buildVoteRoute(service));
  const created = await app.inject({ method: "POST", url: "/arenas", headers: { authorization: `Bearer ${owner}` }, payload: { name: "Works", bracketSize: 2, roundDurationMinutes: 60 } });
  const headers = { authorization: `Bearer ${owner}`, "x-scripta-works": "1" };
  const id = created.json().tournament.id as string;
  const seed = (books: Array<{ workId: string; title: string }>) =>
    app.inject({ method: "PUT", url: `/arenas/${id}/slots`, headers, payload: { slots: books.map((book, slotIndex) => ({ slotIndex, book: { ...book, author: "Someone", cover: null } })) } });
  const view = async () => (await app.inject({ method: "GET", url: `/arenas/${id}`, headers: { "x-scripta-works": "1" } })).json().tournament;
  return { app, db, id, headers, seed, view };
}

const work = (title: string) => resolveWorks([{ isbn: null, title, author: "Someone" }])[0]!;

test("works-format slots store the owner's copy key, or the work id with no copy", async () => {
  const [kept, loose] = [work("Copy Kept"), work("No Copy")];
  libraryCopy("a1", 0, "isbn:9780000000001", kept);
  const { app, db, id, seed, view } = await worksArena("a1");
  assert.equal((await seed([{ workId: kept, title: "Copy Kept" }, { workId: loose, title: "No Copy" }])).statusCode, 204);
  const rows = (db.prepare("SELECT book_key, work_id FROM tournament_slots WHERE tournament_id = ? ORDER BY slot_index").all(id) as Array<Record<string, unknown>>).map((row) => ({ ...row }));
  assert.deepEqual(rows, [{ book_key: "isbn:9780000000001", work_id: kept }, { book_key: loose, work_id: loose }]);
  assert.deepEqual((await view()).slots.map((slot: { workId: string }) => slot.workId), [kept, loose]);
  const legacy = await app.inject({ method: "GET", url: `/arenas/${id}` });
  assert.deepEqual(legacy.json().tournament.slots.map((slot: { key: string }) => slot.key), ["isbn:9780000000001", loose]);
  await app.close();
});

test("a merged-away work id is stored as its canonical work", async () => {
  const [old, target, other] = [work("Merged Away"), work("Merge Target"), work("Other Side")];
  openBooksDb().prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(target, old);
  const { app, db, id, seed } = await worksArena("a2");
  assert.equal((await seed([{ workId: old, title: "Merged Away" }, { workId: other, title: "Other Side" }])).statusCode, 204);
  assert.equal((db.prepare("SELECT work_id FROM tournament_slots WHERE tournament_id = ? AND slot_index = 0").get(id) as { work_id: string }).work_id, target);
  await app.close();
});

test("works-format slots reject an unknown work and two editions of one work", async () => {
  const [old, target] = [work("Edition One"), work("Edition Two")];
  openBooksDb().prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(target, old);
  const { app, seed } = await worksArena("a3");
  const unknown = await seed([{ workId: "not-a-work", title: "X" }, { workId: target, title: "Edition Two" }]);
  assert.equal(unknown.statusCode, 400);
  assert.equal(unknown.json().error, "That book isn't in the catalog.");
  const duplicate = await seed([{ workId: target, title: "Edition Two" }, { workId: old, title: "Edition One" }]);
  assert.equal(duplicate.statusCode, 409);
  assert.match(duplicate.json().error, /Edition One/);
  await app.close();
});

test("votes and tiebreaks by work, including a duel whose sides now share a work", async () => {
  const [a, b] = [work("Side A Book"), work("Side B Book")];
  const { app, db, id, headers, seed, view } = await worksArena("a4");
  await seed([{ workId: a, title: "Side A Book" }, { workId: b, title: "Side B Book" }]);
  assert.equal((await app.inject({ method: "POST", url: `/arenas/${id}/start`, headers })).statusCode, 204);
  const duelId = (await view()).duels[0].id as string;
  const vote = (voterToken: string, workId: string) => app.inject({ method: "POST", url: `/arenas/${id}/duels/${duelId}/vote`, headers: { "x-scripta-works": "1" }, payload: { voterToken, workId } });
  assert.equal((await vote("v1", b)).statusCode, 204);
  assert.equal((await vote("v2", "not-a-work")).statusCode, 400);
  assert.equal((await view()).duels[0].bookB.votes, 1);
  db.prepare("UPDATE duels SET book_b_work_id = book_a_work_id WHERE id = ?").run(duelId);
  assert.equal((await vote("v3", a)).statusCode, 204);
  assert.equal((await view()).duels[0].bookA.votes, 1);
  await app.inject({ method: "POST", url: `/arenas/${id}/duels/${duelId}/settle`, headers });
  assert.equal((await view()).duels[0].status, "tied_pending_tiebreak");
  assert.equal((await app.inject({ method: "POST", url: `/arenas/${id}/duels/${duelId}/tiebreak`, headers, payload: { winnerWorkId: a } })).statusCode, 204);
  assert.equal((await view()).duels[0].winnerWorkId, a);
  await app.close();
});

test("works-format random fill keeps one slot per work", async () => {
  const [a, b, c] = [work("Fill One"), work("Fill Two"), work("Fill Three")];
  const { app, db, id, headers } = await worksArena("a5");
  const res = await app.inject({ method: "POST", url: `/arenas/${id}/random-fill`, headers, payload: { pool: [a, a, b, c].map((workId) => ({ workId, title: "T", author: "A", cover: null })) } });
  assert.equal(res.statusCode, 204);
  const stored = (db.prepare("SELECT work_id FROM tournament_slots WHERE tournament_id = ?").all(id) as Array<{ work_id: string }>).map((row) => row.work_id);
  assert.equal(new Set(stored).size, 2);
  await app.close();
});

test("a works-format re-seed keeps a stored slot key and keys a new work by the normal rule", async () => {
  const [kept, fresh] = [work("Stored Key Book"), work("Fresh Book")];
  const { app, db, id, headers, seed } = await worksArena("a6");
  const legacy = await app.inject({
    method: "PUT",
    url: `/arenas/${id}/slots`,
    headers: { authorization: "Bearer a6" },
    payload: { slots: [{ slotIndex: 0, book: { key: "ta:stored key book|someone", title: "Stored Key Book", author: "Someone", cover: null } }] }
  });
  assert.equal(legacy.statusCode, 204);
  assert.equal((db.prepare("SELECT work_id FROM tournament_slots WHERE tournament_id = ?").get(id) as { work_id: string }).work_id, kept);
  libraryCopy("a6", 0, "isbn:9780000000099", kept);
  libraryCopy("a6", 1, "isbn:9780000000098", fresh);
  assert.equal((await seed([{ workId: kept, title: "Stored Key Book" }, { workId: fresh, title: "Fresh Book" }])).statusCode, 204);
  const rows = (db.prepare("SELECT book_key, work_id FROM tournament_slots WHERE tournament_id = ? ORDER BY slot_index").all(id) as Array<Record<string, unknown>>).map((row) => ({ ...row }));
  assert.deepEqual(rows, [{ book_key: "ta:stored key book|someone", work_id: kept }, { book_key: "isbn:9780000000098", work_id: fresh }]);
  await app.close();
});
