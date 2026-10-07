import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import Fastify from "fastify";
import { DEFAULT_FEED_SETTINGS } from "@scripta/shared/community";
import { ARCHIVE_BATCH } from "./domain/feed.js";
import type { CommunityDeps } from "./service.js";

const tempRoot = mkdtempSync(join(tmpdir(), "community-archive-"));
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
const CUTOFF = "2026-09-02T00:00:00.000Z";
const END_OF_2001 = "2002-01-01T00:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;
const ARCHIVED = "moved old community events to history";
const FAILED = "community event archive failed";
const SHOWS_READING = { ...DEFAULT_FEED_SETTINGS, reading: true };

const unused = () => {
  throw new Error("the archive does not read this");
};
const inertDeps: Omit<CommunityDeps, "repo"> = {
  now: () => NOW,
  background: (task) => {
    void task();
  },
  getDashboardSeenAt: unused,
  setDashboardSeenAt: unused,
  resolveProfile: unused,
  resolveProfiles: unused,
  resolveLibrary: unused,
  readerGlyphFor: unused,
  sharedBookCounts: unused,
  sharedBooks: unused,
  userHasUsername: unused,
  findUserIdByUsername: unused,
  searchUsernameOwners: unused,
  murals: { ownsMural: unused, getMuralPublicPayload: unused },
  tierlists: { discoverWindow: unused, getPublishedMany: unused, votedAmong: unused, get: unused, listByOwner: unused },
  tournaments: { discoverWindow: unused, getPublishedMany: unused, votedAmong: unused, get: unused, listByOwner: unused },
  quizzes: { discoverWindow: unused, getPublishedMany: unused, votedAmong: unused, get: unused, listByOwner: unused },
  participation: { tierlists: unused, tournaments: unused, quizzes: unused }
};

type LogLine = { level: number; msg: string; moved?: number; purged?: number; err?: { message: string } };

function openRepo() {
  const db = openCommunityDb();
  return { db, repo: createSqliteCommunityRepository(db) };
}

function build(t: TestContext) {
  const lines: LogLine[] = [];
  const app = Fastify({ logger: { level: "info", stream: { write: (line: string) => lines.push(JSON.parse(line)) } } });
  t.after(() => app.close());
  const logged = (msg: string) => lines.filter((line) => line.msg === msg);
  return { app, logged };
}

async function until(condition: () => boolean) {
  for (let turns = 0; turns < 200 && !condition(); turns++) await new Promise(setImmediate);
  assert.ok(condition(), "the archive did not finish");
}

function countRows(db: ReturnType<typeof openCommunityDb>, table: string, where = "1 = 1") {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as { n: number }).n;
}

test("a profile's activity pages through recent events and then history with no gap or repeat, wherever the boundary falls and while events move between pages", (t) => {
  const { repo } = openRepo();
  t.after(() => repo.moveEventsBefore(END_OF_2001, 100_000));
  const service = createCommunityService({ ...inertDeps, repo, findUserIdByUsername: (name) => name });
  const days = [1, 2, 3, 4, 4, 5, 6, 7, 8, 9];
  const readAll = (user: string, limit: number, afterPage: () => void): string[] => {
    const ids: string[] = [];
    let cursor: string | null | undefined;
    for (let pages = 0; cursor !== null && pages < 30; pages++) {
      const page = service.getActivity(user, user, cursor ?? undefined, limit);
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      afterPage();
    }
    return ids;
  };

  for (const limit of [1, 2, 3, 4, 9, 10, 11]) {
    for (let moved = 0; moved <= days.length; moved++) {
      const user = `walker-${limit}-${moved}`;
      const rows = days.map((day, i) => ({ id: `${user}-${i}`, created_at: `2001-05-${String(day).padStart(2, "0")}T00:00:00.000Z` }));
      for (const row of rows) repo.insertEvent({ ...row, user_id: user, type: "book_added", ref_type: "book", ref_id: row.id, payload: "{}" });
      const newestFirst = rows.sort((a, b) => (a.created_at === b.created_at ? (a.id > b.id ? -1 : 1) : a.created_at > b.created_at ? -1 : 1)).map((row) => row.id);
      for (let i = 0; i < moved; i++) repo.moveEventsBefore(END_OF_2001, 1);

      assert.deepEqual(readAll(user, limit, () => repo.moveEventsBefore(END_OF_2001, 1)), newestFirst, `limit ${limit}, ${moved} moved first`);
      repo.moveEventsBefore(END_OF_2001, 1000);
    }
  }
});

test("registering the plugin moves events older than 30 days to history, purges their inbox rows, and logs the totals once", async (t) => {
  const { db, repo } = openRepo();
  repo.updateFeedSettings("job-author", SHOWS_READING);
  repo.insertFollow({ follower_id: "job-fan", followee_id: "job-author", created_at: "2026-09-10T00:00:00.000Z" });
  const event = (id: string, createdAt: string) => repo.insertEvent({ id, user_id: "job-author", type: "book_added", ref_type: "book", ref_id: id, payload: null, created_at: createdAt, trace_id: `req-${id}`, source: "PUT /library" });
  for (let i = 0; i < 2500; i++) event(`job-old-${i}`, new Date(Date.parse("2026-08-01T00:00:00.000Z") + i * 60_000).toISOString());
  event("job-before-cutoff", "2026-09-01T23:59:59.999Z");
  event("job-at-cutoff", CUTOFF);
  event("job-recent", "2026-09-20T00:00:00.000Z");
  const { app, logged } = build(t);

  await app.register(communityPlugin, inertDeps);
  await until(() => logged(ARCHIVED).length === 1);

  assert.deepEqual(logged(ARCHIVED).map(({ level, moved, purged }) => ({ level, moved, purged })), [{ level: 30, moved: 2501, purged: 2501 }]);
  assert.deepEqual(db.prepare("SELECT id FROM events WHERE user_id = 'job-author' ORDER BY id").all().map((row) => row.id), ["job-at-cutoff", "job-recent"]);
  assert.equal(countRows(db, "events_history", "user_id = 'job-author'"), 2501);
  const moved = db.prepare("SELECT trace_id, source FROM events_history WHERE id = 'job-before-cutoff'").get();
  assert.deepEqual({ ...moved }, { trace_id: "req-job-before-cutoff", source: "PUT /library" });
  assert.deepEqual(db.prepare("SELECT event_id FROM feed_inbox WHERE viewer_id = 'job-fan' ORDER BY event_id").all().map((row) => row.event_id), ["job-at-cutoff", "job-recent"]);
});

test("the plugin runs again every 24 hours, and stops when the app closes", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { db, repo } = openRepo();
  const event = (id: string) => repo.insertEvent({ id, user_id: "tick-author", type: "book_added", ref_type: "book", ref_id: id, payload: null, created_at: "2026-08-15T00:00:00.000Z" });
  const { app, logged } = build(t);
  await app.register(communityPlugin, inertDeps);
  await until(() => logged(ARCHIVED).length === 1);
  event("tick-1");

  t.mock.timers.tick(DAY_MS - 1);
  assert.equal(countRows(db, "events", "id = 'tick-1'"), 1);
  t.mock.timers.tick(1);
  await until(() => logged(ARCHIVED).length === 2);
  assert.deepEqual(logged(ARCHIVED).map(({ moved, purged }) => ({ moved, purged })), [{ moved: 0, purged: 0 }, { moved: 1, purged: 0 }]);
  assert.equal(countRows(db, "events", "id = 'tick-1'"), 0);

  await app.close();
  event("tick-2");
  t.mock.timers.tick(DAY_MS);
  assert.equal(countRows(db, "events", "id = 'tick-2'"), 1);
});

test("a failed run is logged as an error, leaves the events where they were, throws nowhere, and the next run still happens", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const { db, repo } = openRepo();
  const { app, logged } = build(t);
  await app.register(communityPlugin, inertDeps);
  await until(() => logged(ARCHIVED).length === 1);
  repo.insertEvent({ id: "fail-1", user_id: "fail-author", type: "book_added", ref_type: "book", ref_id: "fail-1", payload: null, created_at: "2026-08-15T00:00:00.000Z" });
  db.exec("CREATE TRIGGER history_refuses BEFORE INSERT ON events_history BEGIN SELECT RAISE(ABORT, 'history refuses'); END");
  t.after(() => db.exec("DROP TRIGGER IF EXISTS history_refuses"));

  t.mock.timers.tick(DAY_MS);
  await until(() => logged(FAILED).length === 1);
  assert.equal(logged(FAILED)[0]?.level, 50);
  assert.match(logged(FAILED)[0]?.err?.message ?? "", /history refuses/);
  assert.equal(countRows(db, "events", "id = 'fail-1'"), 1);
  assert.equal(countRows(db, "events_history", "id = 'fail-1'"), 0);

  db.exec("DROP TRIGGER history_refuses");
  t.mock.timers.tick(DAY_MS);
  await until(() => logged(ARCHIVED).length === 2);
  assert.equal(logged(ARCHIVED)[1]?.moved, 1);
  assert.equal(countRows(db, "events_history", "id = 'fail-1'"), 1);
});

test("the archive gives the event loop a turn after every batch, so no two batches run back to back, the last move batch and the first purge batch included", async () => {
  const { repo } = openRepo();
  repo.moveEventsBefore(CUTOFF, 100_000);
  repo.purgeInboxBefore(CUTOFF, 100_000);
  repo.updateFeedSettings("yield-author", SHOWS_READING);
  repo.insertFollow({ follower_id: "yield-fan", followee_id: "yield-author", created_at: "2026-09-10T00:00:00.000Z" });
  const rows = ARCHIVE_BATCH * 10 + ARCHIVE_BATCH / 2;
  for (let i = 0; i < rows; i++) {
    repo.insertEvent({ id: `yield-${i}`, user_id: "yield-author", type: "book_added", ref_type: "book", ref_id: `yield-${i}`, payload: null, created_at: new Date(Date.parse("2026-08-01T00:00:00.000Z") + i * 60_000).toISOString() });
  }
  let turns = 0;
  let running = true;
  const probe = () => {
    turns++;
    if (running) setImmediate(probe);
  };
  setImmediate(probe);
  const turnAtBatch: number[] = [];
  const service = createCommunityService({
    ...inertDeps,
    repo: {
      ...repo,
      moveEventsBefore: (cutoff, batch) => {
        turnAtBatch.push(turns);
        return repo.moveEventsBefore(cutoff, batch);
      },
      purgeInboxBefore: (cutoff, batch) => {
        turnAtBatch.push(turns);
        return repo.purgeInboxBefore(cutoff, batch);
      }
    }
  });

  const result = await service.archiveOldEvents().finally(() => {
    running = false;
  });

  assert.deepEqual(result, { moved: rows, purged: rows });
  assert.equal(turnAtBatch.length, 2 * (Math.floor(rows / ARCHIVE_BATCH) + 1));
  turnAtBatch.forEach((turn, i) => {
    if (i > 0) assert.ok(turn > turnAtBatch[i - 1]!, `batch ${i} ran in the same turn as the batch before it`);
  });
});
