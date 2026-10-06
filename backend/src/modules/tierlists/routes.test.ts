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

const titleWork = (title: string) => resolveWorks([{ isbn: null, title, author: "Someone" }])[0]!;
const [b1, b2] = [titleWork("Poll Book One"), titleWork("Poll Book Two")] as [string, string];

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
    data: { tiers: tiers.map((t, i) => ({ ...t, workIds: i === 0 ? [b1] : [] })), pool: [b2] }
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
  assert.deepEqual(board.histogram, [{ workId: b1, tierId: topTierId, votes: 1 }]);
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
    payload: { placements: [{ workId: b2, tierId: topTierId }] }
  });

  assert.equal(status, 200);
  assert.equal("ok" in body, false);
  assert.equal(typeof body.ballotId, "string");
  assert.deepEqual(body.placements, [{ workId: b2, tierId: topTierId }]);
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
  assert.deepEqual(body.placements, [{ workId: b1, tierId: topTierId }]);
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
    payload: { placements: [{ workId: b2, tierId: topTierId }] }
  });

  assert.equal(status, 401);
  assert.equal("ok" in body, false);
  assert.equal(typeof body.error, "string");
});

async function ownerApp() {
  const db = new DatabaseSync(":memory:");
  applyTierlistsMigrations(db);
  const service = createTierlistsService(createSqliteTierlistsRepository(db));
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildTierlistRoutes(service));
  return { app, db, service };
}

const headers = (user: string) => ({ authorization: `Bearer ${user}` });
const copy = (userId: string, position: number, key: string, workId: string) =>
  openLibraryDb().prepare("INSERT INTO library_books (user_id, position, book_key, title, author, row_hash, work_id) VALUES (?, ?, ?, 'T', 'A', 'h', ?)").run(userId, position, key, workId);
const tier = (workIds: string[]) => ({ id: "s", label: "S", color: "#c9482f", workIds });
const mergeInto = (old: string, target: string) => openBooksDb().prepare("UPDATE works SET merged_into = ? WHERE id = ?").run(target, old);
const storedWorks = (db: DatabaseSync, id: string) => (db.prepare("SELECT work_id FROM tierlist_works WHERE tierlist_id = ? ORDER BY work_id").all(id) as Array<{ work_id: string }>).map((row) => row.work_id);

test("a create stores and answers work ids", async () => {
  const [held, loose] = [titleWork("Owner Holds"), titleWork("Owner Lacks")];
  copy("t1", 0, "isbn:9780000000002", held);
  const { app, db } = await ownerApp();
  const created = await app.inject({ method: "POST", url: "/tierlists", headers: headers("t1"), payload: { name: "Mine", data: { tiers: [tier([held])], pool: [loose] } } });
  assert.equal(created.statusCode, 201);
  assert.deepEqual(created.json().data, { tiers: [tier([held])], pool: [loose] });
  assert.deepEqual(storedWorks(db, created.json().id), [held, loose].sort());
  const read = await app.inject({ method: "GET", url: `/tierlists/${created.json().id}`, headers: headers("t1") });
  assert.deepEqual(read.json().data, { tiers: [tier([held])], pool: [loose] });
  const listed = await app.inject({ method: "GET", url: "/tierlists", headers: headers("t1") });
  assert.deepEqual(listed.json().tierlists[0].data.pool, [loose]);
  await app.close();
});

test("a create rejects an unknown work, a repeated work, and two editions of one work", async () => {
  const [old, kept] = [titleWork("First Edition"), titleWork("Second Edition")];
  mergeInto(old, kept);
  const { app, db } = await ownerApp();
  const create = (pool: string[]) => app.inject({ method: "POST", url: "/tierlists", headers: headers("t2"), payload: { name: "X", data: { tiers: [tier([])], pool } } });
  assert.equal((await create(["not-a-work"])).statusCode, 400);
  assert.equal((await create([kept, kept])).statusCode, 400);
  const dupes = await create([kept, old]);
  assert.equal(dupes.statusCode, 409);
  assert.match(dupes.json().error, /already here as another edition/);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM tierlists").get() as { count: number }).count, 0);
  await app.close();
});

test("a PUT stores canonical ids and rejects two editions, keeping the stored list", async () => {
  const [old, kept, added] = [titleWork("Put Old"), titleWork("Put Kept"), titleWork("Put Added")];
  mergeInto(old, kept);
  const { app, db } = await ownerApp();
  const created = await app.inject({ method: "POST", url: "/tierlists", headers: headers("t3"), payload: { name: "Put", data: { tiers: [tier([])], pool: [added] } } });
  const id = created.json().id as string;
  const put = await app.inject({ method: "PUT", url: `/tierlists/${id}`, headers: headers("t3"), payload: { data: { tiers: [tier([old])], pool: [added] } } });
  assert.equal(put.statusCode, 200);
  assert.deepEqual(put.json().data, { tiers: [tier([kept])], pool: [added] });
  assert.deepEqual(storedWorks(db, id), [kept, added].sort());
  const dupes = await app.inject({ method: "PUT", url: `/tierlists/${id}`, headers: headers("t3"), payload: { data: { tiers: [tier([old])], pool: [kept] } } });
  assert.equal(dupes.statusCode, 409);
  assert.deepEqual(storedWorks(db, id), [kept, added].sort());
  await app.close();
});

test("a PUT on a list that is not the caller's, or already public, is a 404 and bad data a 400", async () => {
  const a = titleWork("Guard A");
  const { app, service } = await ownerApp();
  const mine = service.createTierlist("t8", "Mine", { tiers: [tier([])], pool: [] });
  const promoted = service.createTierlist("t8", "Promoted", { tiers: [tier([])], pool: [] });
  service.openVoting("t8", promoted.id, "anonymous");
  const data = { tiers: [tier([])], pool: [a] };
  const put = (id: string, user: string, payload: unknown) => app.inject({ method: "PUT", url: `/tierlists/${id}`, headers: headers(user), payload: payload as Record<string, unknown> });
  assert.equal((await put(mine.id, "intruder", { data })).statusCode, 404);
  assert.equal((await put(promoted.id, "t8", { data })).statusCode, 404);
  assert.equal((await put(mine.id, "t8", { data: "nope" })).statusCode, 400);
  assert.equal((await put(mine.id, "t8", { data })).statusCode, 200);
  await app.close();
});

test("an unreachable catalog is a 503 and stores nothing", async () => {
  const a = titleWork("Catalog Down");
  const { app, db, service } = await ownerApp();
  const existing = service.createTierlist("t9", "Existing", { tiers: [tier([])], pool: [a] });
  const catalog = openBooksDb();
  catalog.exec("ALTER TABLE works RENAME TO works_away");
  try {
    const created = await app.inject({ method: "POST", url: "/tierlists", headers: headers("t9"), payload: { name: "Down", data: { tiers: [tier([])], pool: [a] } } });
    assert.equal(created.statusCode, 503);
    const updated = await app.inject({ method: "PUT", url: `/tierlists/${existing.id}`, headers: headers("t9"), payload: { data: { tiers: [tier([a])], pool: [] } } });
    assert.equal(updated.statusCode, 503);
  } finally {
    catalog.exec("ALTER TABLE works_away RENAME TO works");
  }
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM tierlists").get() as { count: number }).count, 1);
  assert.deepEqual(service.getTierlist("t9", existing.id)!.data, { tiers: [tier([])], pool: [a] });
  await app.close();
});

test("owner results and open-voting answer works", async () => {
  const [a, b] = [titleWork("Ranked A"), titleWork("Ranked B")];
  copy("t4", 0, "ta:ranked a|someone", a);
  copy("t4", 1, "ta:ranked b|someone", b);
  const { app } = await ownerApp();
  const created = await app.inject({ method: "POST", url: "/tierlists", headers: headers("t4"), payload: { name: "Poll", data: { tiers: [tier([a])], pool: [b] } } });
  const id = created.json().id as string;
  const opened = await app.inject({ method: "POST", url: `/tierlists/${id}/open-voting`, headers: headers("t4"), payload: { access: "anonymous" } });
  assert.equal(opened.statusCode, 201);
  assert.deepEqual(opened.json().tierlist.data.pool, [b, a]);
  const results = await app.inject({ method: "GET", url: `/tierlists/${id}/results`, headers: headers("t4") });
  assert.deepEqual(results.json().histogram, [{ workId: a, tierId: "s", votes: 1 }]);
  const toggled = await app.inject({ method: "PUT", url: `/tierlists/${id}/voting`, headers: headers("t4"), payload: { open: false } });
  assert.deepEqual(toggled.json().tierlist.data.pool, [b, a]);
  await app.close();
});

const summarize = (userId: string) =>
  openLibraryDb().prepare("INSERT INTO library_summary (user_id, meta, total_books, finished_count, in_progress_count, total_highlights, source_updated_at, rows_version) VALUES (?, '{}', 0, 0, 0, 0, '2026-01-01', 1)").run(userId);

async function publicApp(service: Service, signedInAs?: string) {
  const app = Fastify();
  if (signedInAs) app.decorate("authenticateAccessToken", (token: string) => (token === signedInAs ? { id: signedInAs, email: `${signedInAs}@example.test`, username: signedInAs, avatarId: null } : null));
  await app.register(buildPublicTierlistRoutes(service));
  return app;
}

async function publishedPool(user: string, titles: [string, string]) {
  const works = titles.map(titleWork) as [string, string];
  works.forEach((work, index) => copy(user, index, `ta:${titles[index]!.toLowerCase()}|someone`, work));
  summarize(user);
  const { app, db, service } = await ownerApp();
  const created = await app.inject({ method: "POST", url: "/tierlists", headers: headers(user), payload: { name: "Public", data: { tiers: [tier([])], pool: works }, access: "anonymous" } });
  return { app, db, service, works, id: created.json().id as string, code: created.json().voteCode as string };
}

test("the voting board and ballots speak works", async () => {
  const { app, service, works: [a, b], code } = await publishedPool("t5", ["Board A", "Board B"]);
  const voter = await publicApp(service);
  const board = await voter.inject({ method: "GET", url: `/tierlists/voting/${code}` });
  assert.deepEqual(board.json().board.pool, [a, b]);
  assert.deepEqual(board.json().books.map((book: { key: string; workId: string }) => [book.key, book.workId]), [["ta:board a|someone", a], ["ta:board b|someone", b]]);
  const ballot = await voter.inject({ method: "POST", url: `/tierlists/voting/${code}/ballot`, payload: { placements: [{ workId: b, tierId: "s" }] } });
  assert.equal(ballot.statusCode, 200);
  assert.deepEqual(ballot.json().placements, [{ workId: b, tierId: "s" }]);
  assert.deepEqual(ballot.json().results.histogram, [{ workId: b, tierId: "s", votes: 1 }]);
  const stray = await voter.inject({ method: "POST", url: `/tierlists/voting/${code}/ballot`, payload: { placements: [{ workId: "not-a-work", tierId: "s" }] } });
  assert.equal(stray.statusCode, 400);
  const offBoard = await voter.inject({ method: "POST", url: `/tierlists/voting/${code}/ballot`, payload: { placements: [{ workId: titleWork("Off Board"), tierId: "s" }] } });
  assert.equal(offBoard.statusCode, 400);
  assert.equal(offBoard.json().error, "Those placements don't match this tier list.");
  await voter.close();
  await app.close();
});

test("a ballot naming a work that was merged after the list was written lands on the stored entry", async () => {
  const { app, db, service, works: [old, other], id, code } = await publishedPool("t10", ["Merged Later", "Stays Put"]);
  const target = titleWork("Merge Target Later");
  mergeInto(old, target);
  const voter = await publicApp(service);
  const board = await voter.inject({ method: "GET", url: `/tierlists/voting/${code}` });
  assert.deepEqual(board.json().board.pool, [target, other]);
  assert.deepEqual(board.json().books.map((book: { workId: string }) => book.workId), [target, other]);
  db.prepare("UPDATE tierlists SET public_books = NULL WHERE vote_code = ?").run(code);
  const live = await voter.inject({ method: "GET", url: `/tierlists/voting/${code}` });
  assert.deepEqual(live.json().books.map((book: { workId: string }) => book.workId), [target, other]);
  const ballot = await voter.inject({ method: "POST", url: `/tierlists/voting/${code}/ballot`, payload: { placements: [{ workId: target, tierId: "s" }] } });
  assert.equal(ballot.statusCode, 200);
  assert.deepEqual(ballot.json().placements, [{ workId: target, tierId: "s" }]);
  assert.deepEqual(ballot.json().results.histogram, [{ workId: target, tierId: "s", votes: 1 }]);
  assert.deepEqual(db.prepare("SELECT work_id FROM tierlist_ballot_placements WHERE tierlist_id = ?").all(id).map((row) => row.work_id), [old]);
  await voter.close();
  await app.close();
});

test("a published list with a cleared snapshot shows its books from the library", async () => {
  const { app, db, service, works: [a, b], code } = await publishedPool("t11", ["Cleared A", "Cleared B"]);
  db.prepare("UPDATE tierlists SET public_books = NULL WHERE vote_code = ?").run(code);
  const voter = await publicApp(service);
  const board = await voter.inject({ method: "GET", url: `/tierlists/voting/${code}` });
  assert.deepEqual(board.json().books.map((book: { key: string; workId: string }) => [book.key, book.workId]), [["ta:cleared a|someone", a], ["ta:cleared b|someone", b]]);
  await voter.close();
  await app.close();
});

test("a frozen snapshot missing a pool work falls back to the live library", async () => {
  const { app, service, works: [a, b], code } = await publishedPool("t6", ["Short A", "Short B"]);
  const row = service.getVotingBoard(code)!;
  const voter = await publicApp({ ...service, getVotingBoard: () => ({ ...row, publicBooks: row.publicBooks!.slice(0, 1) }) });
  const board = await voter.inject({ method: "GET", url: `/tierlists/voting/${code}` });
  assert.deepEqual(board.json().books.map((book: { workId: string }) => book.workId), [a, b]);
  await voter.close();
  await app.close();
});

test("ballots keep the members-only and closed-voting refusals", async () => {
  const a = titleWork("Guarded A");
  copy("t7", 0, "ta:guarded a|someone", a);
  summarize("t7");
  const { app, service } = await ownerApp();
  const created = await app.inject({ method: "POST", url: "/tierlists", headers: headers("t7"), payload: { name: "Guarded", data: { tiers: [tier([])], pool: [a] }, access: "members" } });
  const { id, voteCode } = created.json() as { id: string; voteCode: string };
  const voter = await publicApp(service);
  const payload = { placements: [{ workId: a, tierId: "s" }] };
  assert.equal((await voter.inject({ method: "POST", url: `/tierlists/voting/${voteCode}/ballot`, payload })).statusCode, 401);
  await app.inject({ method: "PUT", url: `/tierlists/${id}/voting`, headers: headers("t7"), payload: { access: "anonymous", open: false } });
  assert.equal((await voter.inject({ method: "POST", url: `/tierlists/voting/${voteCode}/ballot`, payload })).statusCode, 409);
  assert.equal((await voter.inject({ method: "POST", url: "/tierlists/voting/nope/ballot", payload })).statusCode, 404);
  await voter.close();
  await app.close();
});

test("a ballot with the catalog down answers 503 and stores no ballot", async () => {
  const { app, db, service, code, id } = await publishedPool("t12", ["Down Ballot A", "Down Ballot B"]);
  const voter = await publicApp(service);
  const placed = titleWork("Down Ballot C");
  const catalog = openBooksDb();
  catalog.exec("ALTER TABLE works RENAME TO works_away");
  try {
    const res = await voter.inject({ method: "POST", url: `/tierlists/voting/${code}/ballot`, payload: { placements: [{ workId: placed, tierId: "s" }] } });
    assert.equal(res.statusCode, 503);
  } finally {
    catalog.exec("ALTER TABLE works_away RENAME TO works");
  }
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM tierlist_ballots WHERE tierlist_id = ?").get(id) as { n: number }).n, 0);
  await voter.close();
  await app.close();
});

function breakCatalog(): () => void {
  const catalog = openBooksDb();
  catalog.exec("ALTER TABLE works RENAME TO works_down");
  return () => {
    catalog.exec("ALTER TABLE works_down RENAME TO works");
    catalog.close();
  };
}

test("an open-voting with the catalog down is a 503 and writes nothing", async () => {
  const [a, b] = [titleWork("Down Ranked A"), titleWork("Down Ranked B")];
  copy("d1", 0, "ta:down ranked a|someone", a);
  copy("d1", 1, "ta:down ranked b|someone", b);
  const { app, service } = await ownerApp();
  const created = await app.inject({ method: "POST", url: "/tierlists", headers: headers("d1"), payload: { name: "Poll", data: { tiers: [tier([a])], pool: [b] } } });
  assert.equal(created.statusCode, 201);
  const id = created.json().id as string;
  const restore = breakCatalog();
  try {
    const opened = await app.inject({ method: "POST", url: `/tierlists/${id}/open-voting`, headers: headers("d1"), payload: { access: "anonymous" } });
    assert.equal(opened.statusCode, 503);
  } finally {
    restore();
  }
  assert.equal(service.getTierlist("d1", id)!.voteCode, null);
  const retried = await app.inject({ method: "POST", url: `/tierlists/${id}/open-voting`, headers: headers("d1"), payload: { access: "anonymous" } });
  assert.equal(retried.statusCode, 201);
  await app.close();
});

test("a create answers from the works it keyed, even if the catalog dies right after the write", async () => {
  const [a, b] = [titleWork("Gone Ranked A"), titleWork("Gone Ranked B")];
  copy("d2", 0, "ta:gone ranked a|someone", a);
  const db = new DatabaseSync(":memory:");
  applyTierlistsMigrations(db);
  const real = createTierlistsService(createSqliteTierlistsRepository(db));
  let restore = () => {};
  const service: Service = {
    ...real,
    createTierlist: (...args) => {
      const tierlist = real.createTierlist(...args);
      restore = breakCatalog();
      return tierlist;
    }
  };
  const app = Fastify();
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  await app.register(buildTierlistRoutes(service));
  try {
    const created = await app.inject({ method: "POST", url: "/tierlists", headers: headers("d2"), payload: { name: "Gone", data: { tiers: [tier([a])], pool: [b] } } });
    assert.equal(created.statusCode, 201);
    assert.deepEqual(created.json().data, { tiers: [tier([a])], pool: [b] });
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM tierlists").get() as { count: number }).count, 1);
  } finally {
    restore();
  }
  await app.close();
});

test("a create with no board answers an empty works board", async () => {
  const { app } = await ownerApp();
  const created = await app.inject({ method: "POST", url: "/tierlists", headers: headers("d3"), payload: { name: "Blank" } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().name, "Blank");
  assert.deepEqual(created.json().data.pool, []);
  assert.ok(created.json().data.tiers.every((entry: { workIds: string[] }) => entry.workIds.length === 0));
  await app.close();
});
