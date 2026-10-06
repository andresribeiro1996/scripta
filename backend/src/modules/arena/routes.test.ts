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

async function worksArena(owner: string) {
  const db = new DatabaseSync(":memory:");
  applyArenaMigrations(db);
  const service = createArenaService(createSqliteArenaRepository(db));
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildArenaRoutes(service));
  await app.register(buildVoteRoute(service));
  const created = await app.inject({ method: "POST", url: "/arenas", headers: { authorization: `Bearer ${owner}` }, payload: { name: "Works", bracketSize: 2, roundDurationMinutes: 60 } });
  const headers = { authorization: `Bearer ${owner}` };
  const id = created.json().tournament.id as string;
  const seed = (books: Array<{ workId: string; title: string }>, as = headers) =>
    app.inject({ method: "PUT", url: `/arenas/${id}/slots`, headers: as, payload: { slots: books.map((book, slotIndex) => ({ slotIndex, book: { ...book, author: "Someone", cover: null } })) } });
  const view = async () => (await app.inject({ method: "GET", url: `/arenas/${id}` })).json().tournament;
  return { app, db, id, headers, seed, view };
}

const work = (title: string) => resolveWorks([{ isbn: null, title, author: "Someone" }])[0]!;

test("slots are stored as works and read back as works with or without the header", async () => {
  const [a, b] = [work("Plain One"), work("Plain Two")];
  const { app, db, id, seed } = await worksArena("a1");
  assert.equal((await seed([{ workId: a, title: "Plain One" }, { workId: b, title: "Plain Two" }])).statusCode, 204);
  const rows = (db.prepare("SELECT work_id FROM tournament_slots WHERE tournament_id = ? ORDER BY slot_index").all(id) as Array<Record<string, unknown>>).map((row) => ({ ...row }));
  assert.deepEqual(rows, [{ work_id: a }, { work_id: b }]);
  for (const headers of [{}, { "x-scripta-works": "1" }]) {
    const res = await app.inject({ method: "GET", url: `/arenas/${id}`, headers });
    const slots = res.json().tournament.slots as Array<Record<string, unknown>>;
    assert.deepEqual(Object.keys(slots[0]!), ["slotIndex", "workId", "title", "author", "cover"]);
    assert.deepEqual(slots.map((slot) => slot.workId), [a, b]);
    assert.doesNotMatch(res.body, /"key"/);
  }
  const mine = await app.inject({ method: "GET", url: "/arenas/mine", headers: { authorization: "Bearer a1" } });
  assert.equal(mine.json().tournaments[0].winner, null);
  await app.close();
});

test("a request without the works header gets works too", async () => {
  const [a, b] = [work("Headerless One"), work("Headerless Two")];
  const { app, id, headers, seed, view } = await worksArena("a1b");
  await seed([{ workId: a, title: "Headerless One" }, { workId: b, title: "Headerless Two" }]);
  await app.inject({ method: "POST", url: `/arenas/${id}/start`, headers });
  const duelId = (await view()).duels[0].id as string;
  await app.inject({ method: "POST", url: `/arenas/${id}/duels/${duelId}/vote`, payload: { voterToken: "t1", workId: a } });
  await app.inject({ method: "POST", url: `/arenas/${id}/duels/${duelId}/settle`, headers });
  const listed = await app.inject({ method: "GET", url: "/arenas/public" });
  assert.deepEqual(listed.json().tournaments[0].winner, { workId: a, title: "Headerless One", author: "Someone", cover: null });
  await app.close();
});

test("PUT slots by a non-owner is a 404 and leaves the slots alone", async () => {
  const [a, b] = [work("Owned One"), work("Owned Two")];
  const { app, db, id, seed } = await worksArena("a1c");
  assert.equal((await seed([{ workId: a, title: "Owned One" }, { workId: b, title: "Owned Two" }])).statusCode, 204);
  const before = db.prepare("SELECT slot_index, work_id, title FROM tournament_slots WHERE tournament_id = ? ORDER BY slot_index").all(id);
  const res = await seed([{ workId: b, title: "Owned Two" }], { authorization: "Bearer someone-else" });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(db.prepare("SELECT slot_index, work_id, title FROM tournament_slots WHERE tournament_id = ? ORDER BY slot_index").all(id), before);
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

test("slots reject an unknown work and two editions of one work", async () => {
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
  const vote = (voterToken: string, workId: string) => app.inject({ method: "POST", url: `/arenas/${id}/duels/${duelId}/vote`, payload: { voterToken, workId } });
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

test("random fill keeps one slot per work", async () => {
  const [a, b, c] = [work("Fill One"), work("Fill Two"), work("Fill Three")];
  const { app, db, id, headers } = await worksArena("a5");
  const res = await app.inject({ method: "POST", url: `/arenas/${id}/random-fill`, headers, payload: { pool: [a, a, b, c].map((workId) => ({ workId, title: "T", author: "A", cover: null })) } });
  assert.equal(res.statusCode, 204);
  const stored = (db.prepare("SELECT work_id FROM tournament_slots WHERE tournament_id = ?").all(id) as Array<{ work_id: string }>).map((row) => row.work_id);
  assert.equal(new Set(stored).size, 2);
  await app.close();
});
