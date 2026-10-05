// Route-level tests for the PUBLIC voting surface's actual wire shape —
// what a `curl` of these routes really returns. The
// results-after-you-submit gate lives in the board route handler (it
// decides what gets serialized, not what the service computes), and the
// ballot routes translate service.ts's internal BallotOutcome union into
// a flat success body, so neither is reachable through service.test.ts's
// fake-repo seam. These drive the real handlers through Fastify's
// inject() instead, over a :memory: database.
//
// Every path/secret env var is pointed at a throwaway temp directory
// BEFORE any module here is imported, so the test can never touch a real
// database or depend on a developer's .env: config/env.ts reads
// process.env once at import time and dotenv doesn't override what's
// already set. That's why the module imports below are dynamic — a
// static import would be hoisted above these assignments.

import assert from "node:assert/strict";
import fastifyMultipart from "@fastify/multipart";
import Fastify, { type InjectOptions } from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import sharp from "sharp";

const scratchDir = mkdtempSync(join(tmpdir(), "tierlists-routes-test-"));
process.env.AUTH_DB_PATH = join(scratchDir, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(scratchDir, "library.sqlite");
process.env.GALLERY_DB_PATH = join(scratchDir, "gallery.sqlite");
process.env.COVERS_DB_PATH = join(scratchDir, "covers.sqlite");
process.env.TIERLISTS_DB_PATH = join(scratchDir, "tierlists.sqlite");
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);

const { applyTierlistsMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteTierlistsRepository } = await import("./adapters/sqlite/sqliteTierlistsRepository.js");
const { createTierlistsService } = await import("./service.js");
const { buildPublicTierlistRoutes, buildTierlistRoutes, buildTierlistShareVideoRoutes } = await import("./routes.js");
const { openLibraryDb } = await import("../library/adapters/sqlite/connection.js");
const { applyBooksMigrations, openBooksDb } = await import("../books/adapters/sqlite/connection.js");
const { resolveWorks } = await import("../books/index.js");

type Service = ReturnType<typeof createTierlistsService>;

/** An open poll whose owner has already ranked b1 into the top tier, so
 *  its histogram is non-empty from ballot #1 onwards. */
function openPoll(access: "anonymous" | "members" = "anonymous") {
  const db = new DatabaseSync(":memory:");
  applyTierlistsMigrations(db);
  const service = createTierlistsService(createSqliteTierlistsRepository(db));

  const original = service.createTierlist("u1", "Fantasy");
  const tiers = (original.data as { tiers: Array<{ id: string; label: string; color: string }> }).tiers;
  service.updateTierlist("u1", original.id, {
    data: { tiers: tiers.map((t, i) => ({ ...t, bookKeys: i === 0 ? ["b1"] : [] })), pool: ["b2"] }
  });
  const copy = service.openVoting("u1", original.id, access)!;

  return { service, copy, code: copy.voteCode!, topTierId: tiers[0]!.id };
}

async function call(service: Service, options: InjectOptions, signedInAs?: string) {
  const app = Fastify();
  if (signedInAs) app.decorate("authenticateAccessToken", (token: string) => token === signedInAs ? { id: signedInAs, email: `${signedInAs}@example.test`, username: signedInAs, avatarId: null } : null);
  await app.register(buildPublicTierlistRoutes(service));
  const res = await app.inject(signedInAs ? { ...options, headers: { ...options.headers, authorization: `Bearer ${signedInAs}` } } : options);
  await app.close();
  return { status: res.statusCode, body: res.json() as Record<string, never> };
}

test("an OPEN poll's board withholds the histogram from anyone reading it", async () => {
  const { service, code } = openPoll();
  const { status, body } = await call(service, { method: "GET", url: `/tierlists/voting/${code}` });

  assert.equal(status, 200);
  const board = body.board as unknown as Record<string, unknown>;
  assert.equal("histogram" in board, false);
  // The ballot count itself is not the sensitive part — the public
  // directory publishes it for every poll, open or closed.
  assert.equal(board.ballotCount, 1);
  assert.equal(board.votingOpen, true);
  assert.equal("id" in board, false);
});

test("share video renders an MP4 only for the published tier list's owner", async () => {
  const { service, copy } = openPoll();
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => token === "u1" || token === "u2" ? { id: token, email: `${token}@example.test`, username: token, avatarId: null } : null);
  await app.register(fastifyMultipart, { limits: { fileSize: 4 * 1024 * 1024, files: 1 } });
  await app.register(buildTierlistShareVideoRoutes(service));

  function upload(image: Buffer, user: string) {
    const boundary = "tierlist-card";
    return app.inject({
      method: "POST",
      url: `/tierlists/${copy.id}/share-video`,
      headers: { authorization: `Bearer ${user}`, "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="card.png"\r\nContent-Type: image/png\r\n\r\n`),
        image,
        Buffer.from(`\r\n--${boundary}--\r\n`)
      ])
    });
  }

  try {
    const png = await sharp({ create: { width: 600, height: 1500, channels: 3, background: "#f2f0ec" } }).png().toBuffer();
    assert.equal((await upload(png, "u2")).statusCode, 404);
    assert.equal((await upload(Buffer.from("not a PNG"), "u1")).statusCode, 400);
    const jpeg = await sharp({ create: { width: 600, height: 1500, channels: 3, background: "#f2f0ec" } }).jpeg().toBuffer();
    assert.equal((await upload(jpeg, "u1")).statusCode, 400);
    const response = await upload(png, "u1");
    assert.equal(response.statusCode, 200);
    const video = Buffer.from((response.json() as { base64: string }).base64, "base64");
    assert.ok(video.length > 1000);
    assert.equal(video.toString("ascii", 4, 8), "ftyp");
  } finally {
    await app.close();
  }
});

test("a CLOSED poll's board carries the final histogram", async () => {
  const { service, copy, code, topTierId } = openPoll();
  service.setVotingState("u1", copy.id, { open: false });

  const { status, body } = await call(service, { method: "GET", url: `/tierlists/voting/${code}` });
  const board = body.board as unknown as Record<string, unknown>;

  assert.equal(status, 200);
  assert.equal(board.votingOpen, false);
  assert.deepEqual(board.histogram, [{ bookKey: "b1", tierId: topTierId, votes: 1 }]);
});

test("an unknown code is a 404 with an error message", async () => {
  const { service } = openPoll();
  const { status, body } = await call(service, { method: "GET", url: "/tierlists/voting/nosuchcode" });
  assert.equal(status, 404);
  assert.equal(typeof body.error, "string");
});

test("a submitted ballot answers with ballotId/placements/results, never the internal outcome union", async () => {
  const { service, code, topTierId } = openPoll();
  const { status, body } = await call(service, {
    method: "POST",
    url: `/tierlists/voting/${code}/ballot`,
    payload: { placements: [{ bookKey: "b2", tierId: topTierId }] }
  });

  assert.equal(status, 200);
  assert.equal("ok" in body, false);
  assert.equal(typeof body.ballotId, "string");
  assert.deepEqual(body.placements, [{ bookKey: "b2", tierId: topTierId }]);
  // Voting is still open, yet the voter DOES get the standings back — the
  // gate is "after you submit", not "after voting closes".
  const results = body.results as unknown as { histogram: unknown[]; ballotCount: number };
  assert.equal(results.ballotCount, 2);
  assert.equal(results.histogram.length, 2);
});

// openVoting moves the owner's ranking out of the tier list document and
// into their seeded ballot, so the owner's own editor has to be able to
// read that ballot back — and it never sees a ballot id, because nothing
// on their device ever stored one.
test("a signed-in voter reads their own ballot without knowing its id", async () => {
  const { service, code, topTierId } = openPoll();
  const { status, body } = await call(service, { method: "GET", url: `/tierlists/voting/${code}/ballot` }, "u1");

  assert.equal(status, 200);
  assert.deepEqual(body.placements, [{ bookKey: "b1", tierId: topTierId }]);
});

test("an anonymous caller has no id-less ballot to read", async () => {
  const { service, code } = openPoll();
  const { status } = await call(service, { method: "GET", url: `/tierlists/voting/${code}/ballot` });
  assert.equal(status, 404);
});

test("a members-only poll refuses an anonymous ballot with 401 {error}", async () => {
  const { service, code, topTierId } = openPoll("members");
  const { status, body } = await call(service, {
    method: "POST",
    url: `/tierlists/voting/${code}/ballot`,
    payload: { placements: [{ bookKey: "b2", tierId: topTierId }] }
  });

  assert.equal(status, 401);
  assert.equal("ok" in body, false);
  assert.equal(typeof body.error, "string");
});

type TierlistRoutesResolver = NonNullable<Parameters<typeof buildTierlistRoutes>[1]>;

async function boardApp(resolveWorks?: TierlistRoutesResolver) {
  const db = new DatabaseSync(":memory:");
  applyTierlistsMigrations(db);
  const service = createTierlistsService(createSqliteTierlistsRepository(db));
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildTierlistRoutes(service, resolveWorks));
  const send = (method: "POST" | "PUT", url: string, user: string, payload: unknown) =>
    app.inject({ method, url, headers: { authorization: `Bearer ${user}` }, payload: payload as Record<string, unknown> });
  return { app, db, service, send };
}

const emptyTier = { id: "s", label: "S", color: "#ff0000", bookKeys: [] as string[] };
const boardOf = (pool: string[]) => ({ tiers: [emptyTier], pool });

function addLibraryBook(userId: string, position: number, bookKey: string, title: string, author: string, isbn: string | null) {
  const library = openLibraryDb();
  library.prepare("INSERT INTO library_books (user_id, position, book_key, title, author, isbn, row_hash) VALUES (?, ?, ?, ?, ?, ?, 'h')").run(userId, position, bookKey, title, author, isbn);
  library.close();
}

function catalogBookCount(): number {
  const catalog = new DatabaseSync(process.env.COVERS_DB_PATH!);
  applyBooksMigrations(catalog);
  const { count } = catalog.prepare("SELECT COUNT(*) AS count FROM books").get() as { count: number };
  catalog.close();
  return count;
}

test("creating a list echoes its keys and stores their works", async () => {
  const { app, db, send } = await boardApp();
  const res = await send("POST", "/tierlists", "u1", { name: "Keys", data: boardOf(["pool-a", "pool-b"]) });
  assert.equal(res.statusCode, 201);
  const created = res.json() as { id: string; data: { pool: string[] } };
  assert.deepEqual(created.data.pool, ["pool-a", "pool-b"]);
  const rows = db.prepare("SELECT key FROM tierlist_works WHERE tierlist_id = ? ORDER BY key").all(created.id) as Array<{ key: string }>;
  assert.deepEqual(rows.map((row) => row.key), ["pool-a", "pool-b"]);
  await app.close();
});

test("creating or updating a list with two editions of one work is a 409", async () => {
  addLibraryBook("u1", 0, "isbn:0441013597", "Dune", "Frank Herbert", "0441013597");
  addLibraryBook("u1", 1, "isbn:9780441013593", "Dune", "Frank Herbert", "9780441013593");
  const { app, db, send } = await boardApp();
  const both = boardOf(["isbn:0441013597", "isbn:9780441013593"]);

  const created = await send("POST", "/tierlists", "u1", { name: "Dupes", data: both });
  assert.equal(created.statusCode, 409);
  assert.match((created.json() as { error: string }).error, /Dune/);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM tierlists").get() as { count: number }).count, 0);

  const single = await send("POST", "/tierlists", "u1", { name: "One", data: boardOf(["isbn:0441013597"]) });
  assert.equal(single.statusCode, 201);
  const id = (single.json() as { id: string }).id;
  const updated = await send("PUT", `/tierlists/${id}`, "u1", { data: both });
  assert.equal(updated.statusCode, 409);
  assert.match((updated.json() as { error: string }).error, /Dune/);
  const stored = db.prepare("SELECT key FROM tierlist_works WHERE tierlist_id = ?").all(id) as Array<{ key: string }>;
  assert.deepEqual(stored.map((row) => row.key), ["isbn:0441013597"]);
  await app.close();
});

test("an unreachable catalog is a 503 and stores nothing", async () => {
  const { WorkResolutionError } = await import("../library/index.js");
  const failing: TierlistRoutesResolver = () => { throw new WorkResolutionError(new Error("down")); };
  const { app, db, service, send } = await boardApp(failing);

  const created = await send("POST", "/tierlists", "u1", { name: "Down", data: boardOf(["pool-a"]) });
  assert.equal(created.statusCode, 503);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM tierlists").get() as { count: number }).count, 0);

  const existing = service.createTierlist("u1", "Existing", boardOf(["old"]));
  const updated = await send("PUT", `/tierlists/${existing.id}`, "u1", { data: boardOf(["new"]) });
  assert.equal(updated.statusCode, 503);
  assert.deepEqual(service.getTierlist("u1", existing.id)!.data, boardOf(["old"]));
  await app.close();
});

test("a rejected update resolves nothing and keeps its status", async () => {
  addLibraryBook("u1", 2, "isbn:9780441569595", "Neuromancer", "William Gibson", "9780441569595");
  addLibraryBook("u2", 0, "isbn:9780441569595", "Neuromancer", "William Gibson", "9780441569595");
  const { app, service, send } = await boardApp();
  const mine = service.createTierlist("u1", "Mine", boardOf([]));
  const promoted = service.createTierlist("u1", "Promoted", boardOf([]));
  service.openVoting("u1", promoted.id, "anonymous");
  const data = boardOf(["isbn:9780441569595"]);

  const before = catalogBookCount();
  assert.equal((await send("PUT", `/tierlists/${mine.id}`, "u2", { data })).statusCode, 404);
  assert.equal((await send("PUT", `/tierlists/${promoted.id}`, "u1", { data })).statusCode, 404);
  assert.equal((await send("PUT", `/tierlists/${mine.id}`, "u1", { data: "nope" })).statusCode, 400);
  assert.equal(catalogBookCount(), before);

  assert.equal((await send("PUT", `/tierlists/${mine.id}`, "u1", { data })).statusCode, 200);
  assert.equal(catalogBookCount(), before + 1);
  await app.close();
});

async function ownerApp() {
  const db = new DatabaseSync(":memory:");
  applyTierlistsMigrations(db);
  const service = createTierlistsService(createSqliteTierlistsRepository(db));
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildTierlistRoutes(service));
  return { app, service };
}

const worksHeaders = (user: string) => ({ authorization: `Bearer ${user}`, "x-scripta-works": "1" });
const titleWork = (title: string) => resolveWorks([{ isbn: null, title, author: "Someone" }])[0]!;
const copy = (userId: string, position: number, key: string, workId: string) =>
  openLibraryDb().prepare("INSERT INTO library_books (user_id, position, book_key, title, author, row_hash, work_id) VALUES (?, ?, ?, 'T', 'A', 'h', ?)").run(userId, position, key, workId);
const tier = (workIds: string[]) => ({ id: "s", label: "S", color: "#c9482f", workIds });

test("a works-format create stores copy keys, answers works, and reads back as keys without the header", async () => {
  const [held, loose] = [titleWork("Owner Holds"), titleWork("Owner Lacks")];
  copy("t1", 0, "isbn:9780000000002", held);
  const { app } = await ownerApp();
  const created = await app.inject({ method: "POST", url: "/tierlists", headers: worksHeaders("t1"), payload: { name: "Mine", data: { tiers: [tier([held])], pool: [loose] } } });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(created.json().data, { tiers: [tier([held])], pool: [loose] });
  const legacy = await app.inject({ method: "GET", url: `/tierlists/${created.json().id}`, headers: { authorization: "Bearer t1" } });
  assert.deepEqual(legacy.json().data, { tiers: [{ id: "s", label: "S", color: "#c9482f", bookKeys: ["isbn:9780000000002"] }], pool: [loose] });
  const listed = await app.inject({ method: "GET", url: "/tierlists", headers: worksHeaders("t1") });
  assert.deepEqual(listed.json().tierlists[0].data.pool, [loose]);
  await app.close();
});

test("a works-format create rejects an unknown work, a repeated work, and two editions of one work", async () => {
  const [old, kept] = [titleWork("First Edition"), titleWork("Second Edition")];
  openBooksDb().prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(kept, old);
  const { app } = await ownerApp();
  const create = (pool: string[]) => app.inject({ method: "POST", url: "/tierlists", headers: worksHeaders("t2"), payload: { name: "X", data: { tiers: [tier([])], pool } } });
  assert.equal((await create(["not-a-work"])).statusCode, 400);
  assert.equal((await create([kept, kept])).statusCode, 400);
  assert.equal((await create([kept, old])).statusCode, 409);
  await app.close();
});

test("a works-format PUT keeps the stored key of a work already on the list", async () => {
  const [held, added] = [titleWork("Kept Key"), titleWork("Added Later")];
  copy("t3", 0, "ta:kept key|someone", held);
  const { app, service } = await ownerApp();
  const created = await app.inject({ method: "POST", url: "/tierlists", headers: { authorization: "Bearer t3" }, payload: { name: "Old build", data: { tiers: [{ id: "s", label: "S", color: "#c9482f", bookKeys: [] }], pool: ["ta:kept key|someone"] } } });
  const id = created.json().id as string;
  const put = await app.inject({ method: "PUT", url: `/tierlists/${id}`, headers: worksHeaders("t3"), payload: { data: { tiers: [tier([held])], pool: [added] } } });
  assert.equal(put.statusCode, 200);
  assert.deepEqual(put.json().data, { tiers: [tier([held])], pool: [added] });
  assert.deepEqual((service.getTierlist("t3", id)!.data as { tiers: Array<{ bookKeys: string[] }> }).tiers[0]!.bookKeys, ["ta:kept key|someone"]);
  await app.close();
});

test("owner results and open-voting answer works", async () => {
  const [a, b] = [titleWork("Ranked A"), titleWork("Ranked B")];
  copy("t4", 0, "ta:ranked a|someone", a);
  copy("t4", 1, "ta:ranked b|someone", b);
  const { app } = await ownerApp();
  const created = await app.inject({ method: "POST", url: "/tierlists", headers: worksHeaders("t4"), payload: { name: "Poll", data: { tiers: [tier([a])], pool: [b] } } });
  const id = created.json().id as string;
  const opened = await app.inject({ method: "POST", url: `/tierlists/${id}/open-voting`, headers: worksHeaders("t4"), payload: { access: "anonymous" } });
  assert.equal(opened.statusCode, 201);
  assert.deepEqual(opened.json().tierlist.data.pool, [b, a]);
  const results = await app.inject({ method: "GET", url: `/tierlists/${id}/results`, headers: worksHeaders("t4") });
  assert.deepEqual(results.json().histogram, [{ workId: a, tierId: "s", votes: 1 }]);
  const toggled = await app.inject({ method: "PUT", url: `/tierlists/${id}/voting`, headers: worksHeaders("t4"), payload: { open: false } });
  assert.deepEqual(toggled.json().tierlist.data.pool, [b, a]);
  await app.close();
});
