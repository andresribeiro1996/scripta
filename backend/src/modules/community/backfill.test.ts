import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import Fastify from "fastify";
import { DEFAULT_FEED_SETTINGS } from "@scripta/shared/community";
import type { CommunityRepository } from "./domain/ports.js";
import type { CommunityDeps, CommunityService } from "./service.js";

const tempRoot = mkdtempSync(join(tmpdir(), "community-backfill-"));
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);
process.env.AUTH_DB_PATH = join(tempRoot, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(tempRoot, "library.sqlite");
process.env.GALLERY_DB_PATH = join(tempRoot, "gallery.sqlite");
process.env.COMMUNITY_DB_PATH = join(tempRoot, "community.sqlite");

const { openCommunityDb } = await import("./adapters/sqlite/connection.js");
const { createSqliteCommunityRepository } = await import("./adapters/sqlite/sqliteCommunityRepository.js");
const { communityPlugin } = await import("./plugin.js");
const { createCommunityService } = await import("./service.js");

const NOW = Date.parse("2026-10-02T00:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const READING_ON = { ...DEFAULT_FEED_SETTINGS, reading: true };
const READING_OFF = DEFAULT_FEED_SETTINGS;
const FAILED = "community feed backfill failed";

const unused = () => {
  throw new Error("the backfill does not read this");
};
const baseDeps: Omit<CommunityDeps, "repo" | "background"> = {
  now: () => NOW,
  getDashboardSeenAt: () => null,
  setDashboardSeenAt: unused,
  resolveProfile: unused,
  resolveProfiles: (ids) => new Map(ids.map((id) => [id, { username: id, avatarUrl: null }])),
  resolveLibrary: unused,
  readerGlyphFor: () => null,
  sharedBookCounts: unused,
  sharedBooks: unused,
  userHasUsername: () => true,
  findUserIdByUsername: unused,
  searchUsernameOwners: unused,
  murals: { ownsMural: unused, getMuralPublicPayload: unused },
  tierlists: { discoverWindow: unused, getPublishedMany: unused, votedAmong: unused, get: unused, listByOwner: unused },
  tournaments: { discoverWindow: unused, getPublishedMany: unused, votedAmong: unused, get: unused, listByOwner: unused },
  participation: { tierlists: unused, tournaments: unused, quizzes: unused }
};

type Db = ReturnType<typeof openCommunityDb>;
type LogLine = { level: number; msg: string; err?: { message: string } };

function world(wrap: (repo: CommunityRepository) => CommunityRepository = (repo) => repo) {
  const db = openCommunityDb();
  const repo = createSqliteCommunityRepository(db);
  const tasks: Promise<void>[] = [];
  const service = createCommunityService({
    ...baseDeps,
    repo: wrap(repo),
    background: (task) => {
      tasks.push(task());
    }
  });
  return { db, repo, service, tasks, settled: () => Promise.all(tasks) };
}

const daysAgo = (days: number) => new Date(NOW - days * DAY_MS).toISOString();

function bookEvent(repo: CommunityRepository, author: string, id: string, createdAt: string) {
  repo.insertEvent({ id, user_id: author, type: "book_added", ref_type: "book", ref_id: id, payload: JSON.stringify({ title: id, author: "Someone" }), created_at: createdAt });
}

function follow(repo: CommunityRepository, follower: string, author: string) {
  repo.insertFollow({ follower_id: follower, followee_id: author, created_at: daysAgo(40) });
}

function inboxRows(db: Db, viewer: string) {
  return db.prepare("SELECT created_at, event_id FROM feed_inbox WHERE viewer_id = ? ORDER BY created_at DESC, event_id DESC").all(viewer).map((row) => ({ ...row }));
}

function inboxEventIds(db: Db, viewer: string) {
  return inboxRows(db, viewer).map((row) => row.event_id);
}

function authoredRows(db: Db, author: string) {
  return (db.prepare("SELECT COUNT(*) AS n FROM feed_inbox WHERE author_id = ?").get(author) as { n: number }).n;
}

const dashboardIds = (service: CommunityService, viewer: string) => service.getDashboard(viewer, undefined, 50).items.map((item) => item.id);

function build(t: TestContext) {
  const lines: LogLine[] = [];
  const app = Fastify({ logger: { level: "info", stream: { write: (line: string) => lines.push(JSON.parse(line)) } } });
  app.decorate("authenticateAccessToken", (token: string) => ({ id: token, email: `${token}@example.test`, username: token, avatarId: null }));
  t.after(() => app.close());
  const logged = (msg: string) => lines.filter((line) => line.msg === msg);
  return { app, logged };
}

async function until(condition: () => boolean) {
  for (let turns = 0; turns < 200 && !condition(); turns++) await new Promise(setImmediate);
  assert.ok(condition(), "the condition was not met");
}

const WAYS: Array<[string, string, (service: CommunityService, author: string) => void]> = [
  ["settings", "updateFeedSettings", (service, author) => service.updateFeedSettings(author, READING_ON)],
  ["publish", "publishProfile with shareReading", (service, author) => service.publishProfile(author, { shareReading: true })]
];

for (const [key, way, turnReadingOn] of WAYS) {
  test(`turning reading on through ${way} puts the author's last 30 days of book events into every follower's dashboard, with their own dates, and no older event`, async () => {
    const { db, repo, service, tasks, settled } = world();
    const author = `${key}-author`;
    bookEvent(repo, author, `${key}-recent`, daysAgo(1));
    bookEvent(repo, author, `${key}-middle`, daysAgo(12));
    bookEvent(repo, author, `${key}-edge`, daysAgo(30));
    bookEvent(repo, author, `${key}-old`, new Date(NOW - 30 * DAY_MS - 1).toISOString());
    const fans = [`${key}-fan-1`, `${key}-fan-2`];
    for (const fan of fans) follow(repo, fan, author);
    for (const fan of fans) assert.deepEqual(dashboardIds(service, fan), []);

    turnReadingOn(service, author);
    assert.equal(tasks.length, 1);
    await settled();

    for (const fan of fans) {
      assert.deepEqual(dashboardIds(service, fan), [`${key}-recent`, `${key}-middle`, `${key}-edge`]);
      assert.deepEqual(inboxRows(db, fan).map((row) => row.created_at), [daysAgo(1), daysAgo(12), daysAgo(30)]);
    }
  });
}

test("backfilled rows take their place among the rows already in the feed by date", async () => {
  const { repo, service, settled } = world();
  repo.updateFeedSettings("date-bob", READING_ON);
  follow(repo, "date-fan", "date-ann");
  follow(repo, "date-fan", "date-bob");
  const events: Array<[string, number]> = [["ann", 2], ["bob", 4], ["ann", 6], ["bob", 10], ["ann", 20]];
  events.forEach(([who, days], i) => bookEvent(repo, `date-${who}`, `date-${i}-${who}`, daysAgo(days)));
  assert.deepEqual(dashboardIds(service, "date-fan"), ["date-1-bob", "date-3-bob"]);

  service.updateFeedSettings("date-ann", READING_ON);
  await settled();

  assert.deepEqual(dashboardIds(service, "date-fan"), ["date-0-ann", "date-1-bob", "date-2-ann", "date-3-bob", "date-4-ann"]);
});

test("with 150 events in the window each follower gets the newest 100", async () => {
  const { db, repo, service, settled } = world();
  const author = "limit-author";
  for (let i = 0; i < 150; i++) bookEvent(repo, author, `limit-${String(i).padStart(3, "0")}`, new Date(NOW - i * HOUR_MS).toISOString());
  for (const fan of ["limit-fan-1", "limit-fan-2"]) follow(repo, fan, author);

  service.updateFeedSettings(author, READING_ON);
  await settled();

  const newest100 = Array.from({ length: 100 }, (_, i) => `limit-${String(i).padStart(3, "0")}`).sort();
  for (const fan of ["limit-fan-1", "limit-fan-2"]) assert.deepEqual(inboxEventIds(db, fan).sort(), newest100);
});

test("only the types of the categories that came on are backfilled, so the publications already in the inbox do not use up the limit of 100", async () => {
  const { db, repo, service, tasks, settled } = world();
  const author = "types-author";
  follow(repo, "types-fan", author);
  for (let i = 0; i < 120; i++) repo.insertEvent({ id: `types-pub-${i}`, user_id: author, type: "tierlist_published", ref_type: "tierlist", ref_id: `types-t${i}`, payload: null, created_at: new Date(NOW - i * HOUR_MS).toISOString() });
  for (let i = 0; i < 3; i++) bookEvent(repo, author, `types-book-${i}`, new Date(NOW - (200 + i) * HOUR_MS).toISOString());
  assert.equal(inboxEventIds(db, "types-fan").length, 120);

  service.updateFeedSettings(author, READING_ON);
  await settled();

  assert.equal(tasks.length, 1);
  assert.equal(inboxEventIds(db, "types-fan").length, 123);
  assert.deepEqual(inboxEventIds(db, "types-fan").slice(-3), ["types-book-0", "types-book-1", "types-book-2"]);
});

test("switching reading off and on again adds no second row, and brings the rows written earlier and the events of the gap into the feed", async () => {
  const { db, repo, service, settled } = world();
  const author = "cycle-author";
  follow(repo, "cycle-fan", author);
  service.updateFeedSettings(author, READING_ON);
  bookEvent(repo, author, "cycle-1", daysAgo(5));
  bookEvent(repo, author, "cycle-2", daysAgo(4));
  await settled();
  assert.deepEqual(dashboardIds(service, "cycle-fan"), ["cycle-2", "cycle-1"]);

  service.updateFeedSettings(author, READING_OFF);
  bookEvent(repo, author, "cycle-3", daysAgo(3));
  assert.deepEqual(dashboardIds(service, "cycle-fan"), []);
  assert.deepEqual(inboxEventIds(db, "cycle-fan"), ["cycle-2", "cycle-1"]);

  service.updateFeedSettings(author, READING_ON);
  await settled();
  assert.deepEqual(inboxEventIds(db, "cycle-fan"), ["cycle-3", "cycle-2", "cycle-1"]);
  assert.deepEqual(dashboardIds(service, "cycle-fan"), ["cycle-3", "cycle-2", "cycle-1"]);
});

test("only current followers get rows: not a reader who never followed, one who follows only someone else, nor one who unfollowed before reading was turned on", async () => {
  const { db, repo, service, settled } = world();
  const author = "only-author";
  bookEvent(repo, author, "only-1", daysAgo(2));
  follow(repo, "only-fan", author);
  follow(repo, "only-left", author);
  follow(repo, "only-left", "only-other");
  follow(repo, "only-other-fan", "only-other");
  repo.deleteFollow("only-left", author);

  service.updateFeedSettings(author, READING_ON);
  await settled();

  assert.deepEqual(inboxEventIds(db, "only-fan"), ["only-1"]);
  for (const reader of ["only-stranger", "only-left", "only-other-fan", author]) assert.deepEqual(inboxEventIds(db, reader), [], reader);
});

test("a category switched off again before the backfill reaches the followers gets no row written", async () => {
  const { db, repo, service, tasks, settled } = world();
  const author = "flip-author";
  bookEvent(repo, author, "flip-1", daysAgo(2));
  follow(repo, "flip-fan", author);

  service.updateFeedSettings(author, READING_ON);
  service.updateFeedSettings(author, READING_OFF);
  await settled();

  assert.equal(tasks.length, 1);
  assert.deepEqual(inboxEventIds(db, "flip-fan"), []);
});

test("about 120 followers are backfilled in batches of 50, the first not inside the request and a turn of the event loop between any two, and a follower who unfollows before their batch runs gets nothing", async () => {
  const author = "batch-author";
  const other = "batch-other";
  const victims: string[] = [];
  const batches: Array<{ turn: number; size: number }> = [];
  let turns = 0;
  let running = true;
  const probe = () => {
    turns++;
    if (running) setImmediate(probe);
  };
  const { db, repo, service, settled } = world((real) => ({
    ...real,
    backfillInbox: (authorId, followerIds, types, since) => {
      batches.push({ turn: turns, size: followerIds.length });
      if (batches.length === 2) for (const victim of victims) real.deleteFollow(victim, author);
      real.backfillInbox(authorId, followerIds, types, since);
    }
  }));
  for (let i = 0; i < 3; i++) bookEvent(repo, author, `batch-${i}`, daysAgo(i + 1));
  for (let i = 0; i < 120; i++) follow(repo, `batch-fan-${String(i).padStart(3, "0")}`, author);
  const order = repo.listFollowerIds(author);
  victims.push(order[60]!, order[110]!);
  for (const victim of victims) follow(repo, victim, other);
  setImmediate(probe);

  service.updateFeedSettings(author, READING_ON);
  const turnOfRequest = turns;
  await settled().finally(() => {
    running = false;
  });

  assert.deepEqual(batches.map((batch) => batch.size), [50, 50, 20]);
  assert.ok(batches[0]!.turn > turnOfRequest, "the first batch ran inside the request");
  batches.forEach((batch, i) => {
    if (i > 0) assert.ok(batch.turn > batches[i - 1]!.turn, `batch ${i} ran in the same turn as the batch before it`);
  });
  for (const victim of victims) assert.deepEqual(inboxEventIds(db, victim), [], victim);
  assert.equal(order.filter((follower) => inboxEventIds(db, follower).length === 3).length, 118);
  assert.equal(authoredRows(db, author), 118 * 3);
});

test("an author erased between two batches is left with no inbox row, the first batch's included, and no profile", async () => {
  const author = "erase-author";
  let batches = 0;
  const { db, repo, service, settled } = world((real) => ({
    ...real,
    backfillInbox: (authorId, followerIds, types, since) => {
      if (++batches === 2) real.deleteUserData(author);
      real.backfillInbox(authorId, followerIds, types, since);
    }
  }));
  bookEvent(repo, author, "erase-1", daysAgo(1));
  for (let i = 0; i < 120; i++) follow(repo, `erase-fan-${String(i).padStart(3, "0")}`, author);

  service.updateFeedSettings(author, READING_ON);
  await settled();

  assert.equal(authoredRows(db, author), 0);
  assert.equal(db.prepare("SELECT 1 FROM profiles WHERE user_id = ?").get(author), undefined);
});

test("a follower erased before their batch gets no row, and the other followers still get theirs", async () => {
  const author = "gone-author";
  let erased = "";
  let batches = 0;
  const { db, repo, service, settled } = world((real) => ({
    ...real,
    backfillInbox: (authorId, followerIds, types, since) => {
      if (++batches === 2) real.deleteUserData(erased);
      real.backfillInbox(authorId, followerIds, types, since);
    }
  }));
  bookEvent(repo, author, "gone-1", daysAgo(1));
  for (let i = 0; i < 120; i++) follow(repo, `gone-fan-${String(i).padStart(3, "0")}`, author);
  erased = repo.listFollowerIds(author)[60]!;

  service.updateFeedSettings(author, READING_ON);
  await settled();

  assert.deepEqual(inboxEventIds(db, erased), []);
  assert.equal(authoredRows(db, author), 119);
});

test("a backfill that fails is logged as an error by the plugin, after the settings route has answered 204", async (t) => {
  const db = openCommunityDb();
  const repo = createSqliteCommunityRepository(db);
  const author = "log-author";
  bookEvent(repo, author, "log-1", daysAgo(2));
  follow(repo, "log-fan", author);
  db.exec("CREATE TRIGGER backfill_refuses BEFORE INSERT ON feed_inbox WHEN NEW.viewer_id = 'log-fan' BEGIN SELECT RAISE(ABORT, 'inbox refuses'); END");
  t.after(() => db.exec("DROP TRIGGER IF EXISTS backfill_refuses"));
  const { app, logged } = build(t);
  await app.register(communityPlugin, baseDeps);

  const res = await app.inject({ method: "PUT", url: "/community/profile/feed-settings", headers: { authorization: `Bearer ${author}` }, payload: READING_ON });

  assert.equal(res.statusCode, 204);
  await until(() => logged(FAILED).length === 1);
  assert.equal(logged(FAILED)[0]?.level, 50);
  assert.match(logged(FAILED)[0]?.err?.message ?? "", /feed backfill for log-author failed/);
  assert.match(logged(FAILED)[0]?.err?.message ?? "", /inbox refuses/);
  assert.equal(repo.getFeedSettings(author)?.reading, true);
  assert.deepEqual(inboxEventIds(db, "log-fan"), []);
});

test("the plugin runs a backfill after answering 204, and logs no failure when it succeeds", async (t) => {
  const db = openCommunityDb();
  const repo = createSqliteCommunityRepository(db);
  const author = "plugin-author";
  bookEvent(repo, author, "plugin-1", daysAgo(2));
  follow(repo, "plugin-fan", author);
  const { app, logged } = build(t);
  await app.register(communityPlugin, baseDeps);

  const res = await app.inject({ method: "PUT", url: "/community/profile/feed-settings", headers: { authorization: `Bearer ${author}` }, payload: READING_ON });

  assert.equal(res.statusCode, 204);
  await until(() => inboxEventIds(db, "plugin-fan").length === 1);
  assert.deepEqual(inboxEventIds(db, "plugin-fan"), ["plugin-1"]);
  assert.deepEqual(logged(FAILED), []);
});
