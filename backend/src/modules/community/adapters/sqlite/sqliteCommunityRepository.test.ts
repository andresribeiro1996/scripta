import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { categoryFor, DEFAULT_FEED_SETTINGS, type FeedCategory } from "@scripta/shared/community";
import { registerTrace } from "../../../../trace.js";
import { FEED_EVENT_TYPES } from "../../domain/feed.js";

const tempRoot = mkdtempSync(join(tmpdir(), "community-repo-"));
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);
process.env.AUTH_DB_PATH = join(tempRoot, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(tempRoot, "library.sqlite");
process.env.GALLERY_DB_PATH = join(tempRoot, "gallery.sqlite");
process.env.COMMUNITY_DB_PATH = join(tempRoot, "community.sqlite");

const { openCommunityDb } = await import("./connection.js");
const { createSqliteCommunityRepository } = await import("./sqliteCommunityRepository.js");
const { createCommunityPublicApi } = await import("../../service.js");

function repo() {
  return createSqliteCommunityRepository(openCommunityDb());
}

test("follows are idempotent and counted per side", () => {
  const r = repo();
  r.insertFollow({ follower_id: "bob", followee_id: "alice", created_at: "2026-09-10T00:00:00.000Z" });
  r.insertFollow({ follower_id: "bob", followee_id: "alice", created_at: "2026-09-10T00:00:00.000Z" });
  assert.equal(r.getFollow("bob", "alice")?.followee_id, "alice");
  assert.equal(r.countFollowers("alice"), 1);
  assert.equal(r.countFollowing("bob"), 1);
  assert.deepEqual(r.listFollowees("bob"), ["alice"]);
});

test("deleteFollow reports whether a row was removed", () => {
  const r = repo();
  r.insertFollow({ follower_id: "bob", followee_id: "alice", created_at: "2026-09-10T00:00:00.000Z" });
  assert.equal(r.deleteFollow("bob", "alice"), true);
  assert.equal(r.deleteFollow("bob", "alice"), false);
});

test("profiles upsert in place", () => {
  const r = repo();
  r.upsertProfile({ user_id: "alice", published: 1, mural_id: "m1", published_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z", feed_settings: null });
  r.upsertProfile({ user_id: "alice", published: 1, mural_id: "m2", published_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-02T00:00:00.000Z", feed_settings: null });
  assert.equal(r.getProfileRow("alice")?.mural_id, "m2");
});

test("events ignore duplicate (ref_type, ref_id) and paginate by keyset", () => {
  const r = repo();
  r.insertEvent({ id: "e1", user_id: "alice", type: "tierlist_published", ref_type: "tierlist", ref_id: "t1", payload: null, created_at: "2026-09-02T00:00:00.000Z" });
  r.insertEvent({ id: "e2", user_id: "alice", type: "tierlist_published", ref_type: "tierlist", ref_id: "t1", payload: null, created_at: "2026-09-03T00:00:00.000Z" });
  r.insertEvent({ id: "e3", user_id: "alice", type: "tournament_published", ref_type: "tournament", ref_id: "g1", payload: null, created_at: "2026-09-01T00:00:00.000Z" });
  assert.equal(r.listEventsByUser("alice", undefined, 10).length, 2);

  const page = r.listEventsByUser("alice", { createdAt: "2026-09-02T00:00:00.000Z", id: "e1" }, 10);
  assert.deepEqual(page.map((e) => e.id), ["e3"]);
  assert.deepEqual(r.listEventsByUser("bob", undefined, 10), []);
});

test("events narrow to the requested types, with or without a keyset, and newer than a marker", () => {
  const r = repo();
  const at = (day: number) => `2026-09-0${day}T00:00:00.000Z`;
  r.insertEvent({ id: "typed-1", user_id: "typed", type: "tierlist_published", ref_type: "tierlist", ref_id: "typed-t1", payload: null, created_at: at(1) });
  r.insertEvent({ id: "typed-2", user_id: "typed", type: "book_added", ref_type: "book", ref_id: "typed-b2", payload: null, created_at: at(2) });
  r.insertEvent({ id: "typed-3", user_id: "typed", type: "tierlist_published", ref_type: "tierlist", ref_id: "typed-t3", payload: null, created_at: at(3) });
  r.insertEvent({ id: "typed-4", user_id: "typed", type: "voted_on", ref_type: "tierlist", ref_id: "typed-t4", payload: null, created_at: at(4) });
  r.insertEvent({ id: "typed-5", user_id: "typed", type: "book_finished", ref_type: "book", ref_id: "typed-b5", payload: null, created_at: at(5) });
  const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

  assert.deepEqual(ids(r.listEventsByUser("typed", undefined, 10)), ["typed-5", "typed-4", "typed-3", "typed-2", "typed-1"]);
  assert.deepEqual(ids(r.listEventsByUser("typed", undefined, 10, ["tierlist_published"])), ["typed-3", "typed-1"]);
  assert.deepEqual(ids(r.listEventsByUser("typed", undefined, 1, ["tierlist_published", "book_added"])), ["typed-3"]);
  assert.deepEqual(ids(r.listEventsByUser("typed", { createdAt: at(3), id: "typed-3" }, 10, ["tierlist_published", "book_added"])), ["typed-2", "typed-1"]);
  assert.deepEqual(r.listEventsByUser("typed", undefined, 10, []), []);

  assert.deepEqual(ids(r.listEventsByUserSince("typed", at(2), 10, ["tierlist_published", "book_added", "book_finished"])), ["typed-5", "typed-3"]);
  assert.deepEqual(ids(r.listEventsByUserSince("typed", at(2), 1, ["tierlist_published", "book_finished"])), ["typed-5"]);
  assert.deepEqual(r.listEventsByUserSince("typed", at(2), 10, []), []);
  assert.deepEqual(r.listEventsByUserSince("typed", at(5), 10, ["book_finished"]), []);
});

test("an event keeps the trace that caused it, or nulls when it was given none", () => {
  const r = repo();
  r.insertEvent({ id: "trace-e1", user_id: "traced", type: "tierlist_published", ref_type: "tierlist", ref_id: "trace-t1", payload: null, created_at: "2026-09-02T00:00:00.000Z", trace_id: "req-1", source: "POST /tierlists/:id/open-voting" });
  r.insertEvent({ id: "trace-e2", user_id: "traced", type: "tournament_published", ref_type: "tournament", ref_id: "trace-g1", payload: null, created_at: "2026-09-01T00:00:00.000Z" });

  assert.deepEqual(r.listEventsByUser("traced", undefined, 10).map((e) => [e.id, e.trace_id, e.source]), [
    ["trace-e1", "req-1", "POST /tierlists/:id/open-voting"],
    ["trace-e2", null, null]
  ]);
});

test("an event emitted while a request is handled is stored with that request's id and route, and one emitted outside a request with neither", async () => {
  const db = openCommunityDb();
  const publicApi = createCommunityPublicApi(createSqliteCommunityRepository(db));
  const app = Fastify();
  registerTrace(app);
  app.post("/tierlists/:id/open-voting", (request) => {
    publicApi.emitEvent("emitter", "tierlist_published", "tierlist", "emit-t1");
    return { requestId: request.id };
  });

  const { requestId } = (await app.inject({ method: "POST", url: "/tierlists/9/open-voting" })).json();
  publicApi.emitEvent("emitter", "tournament_published", "tournament", "emit-g1");
  await app.close();

  const rows = db.prepare("SELECT ref_id, trace_id, source FROM events WHERE user_id = 'emitter' ORDER BY ref_id").all().map((row) => ({ ...row }));
  assert.deepEqual(rows, [
    { ref_id: "emit-g1", trace_id: null, source: null },
    { ref_id: "emit-t1", trace_id: requestId, source: "POST /tierlists/:id/open-voting" }
  ]);
});

test("listFollowersSince returns only follows after the marker, newest first", () => {
  const r = repo();
  const at = (day: number) => `2026-09-0${day}T00:00:00.000Z`;
  r.insertFollow({ follower_id: "since-a", followee_id: "since-host", created_at: at(1) });
  r.insertFollow({ follower_id: "since-b", followee_id: "since-host", created_at: at(3) });
  r.insertFollow({ follower_id: "since-c", followee_id: "since-host", created_at: at(5) });
  r.insertFollow({ follower_id: "since-d", followee_id: "since-host", created_at: at(5) });
  r.insertFollow({ follower_id: "since-a", followee_id: "since-other", created_at: at(6) });
  const ids = (rows: Array<{ follower_id: string }>) => rows.map((row) => row.follower_id);

  assert.deepEqual(ids(r.listFollowersSince("since-host", at(3), 10)), ["since-d", "since-c"]);
  assert.deepEqual(ids(r.listFollowersSince("since-host", at(1), 2)), ["since-d", "since-c"]);
  assert.deepEqual(r.listFollowersSince("since-host", at(5), 10), []);
  assert.deepEqual(ids(r.listFollowersSince("since-other", at(1), 10)), ["since-a"]);
});

test("followers order newest first per (created_at, follower_id), paginate by keyset, and drop unfollowed rows", () => {
  const r = repo();
  r.insertFollow({ follower_id: "bob", followee_id: "alice", created_at: "2026-09-02T00:00:00.000Z" });
  r.insertFollow({ follower_id: "adam", followee_id: "alice", created_at: "2026-09-02T00:00:00.000Z" });
  r.insertFollow({ follower_id: "carol", followee_id: "alice", created_at: "2026-09-03T00:00:00.000Z" });
  r.insertFollow({ follower_id: "dave", followee_id: "alice", created_at: "2026-09-01T00:00:00.000Z" });
  assert.deepEqual(r.listFollowersByFollowee("alice", undefined, 10).map((f) => f.follower_id), ["carol", "bob", "adam", "dave"]);

  const page = r.listFollowersByFollowee("alice", { createdAt: "2026-09-02T00:00:00.000Z", id: "bob" }, 10);
  assert.deepEqual(page.map((f) => f.follower_id), ["adam", "dave"]);
  assert.deepEqual(r.listFollowersByFollowee("ghost", undefined, 10), []);
  r.deleteFollow("dave", "alice");
  assert.deepEqual(r.listFollowersByFollowee("alice", undefined, 10).map((f) => f.follower_id), ["carol", "bob", "adam"]);
});


test("deleteUserData removes follows both ways, the profile, and events by or about the user", () => {
  const r = repo();
  const at = "2026-09-10T00:00:00.000Z";
  r.insertFollow({ follower_id: "leaver", followee_id: "carol", created_at: at });
  r.insertFollow({ follower_id: "carol", followee_id: "leaver", created_at: at });
  r.insertFollow({ follower_id: "carol", followee_id: "dave", created_at: at });
  r.upsertProfile({ user_id: "leaver", published: 1, mural_id: null, published_at: at, updated_at: at, feed_settings: null });
  r.insertEvent({ id: "erase-e1", user_id: "leaver", type: "book_finished", ref_type: "book", ref_id: "k", payload: null, created_at: at });
  r.insertEvent({ id: "erase-e2", user_id: "carol", type: "following", ref_type: "user", ref_id: "leaver", payload: null, created_at: at });
  r.insertEvent({ id: "erase-e3", user_id: "carol", type: "following", ref_type: "user", ref_id: "dave", payload: null, created_at: at });
  r.deleteUserData("leaver");
  assert.equal(r.getFollow("leaver", "carol"), undefined);
  assert.equal(r.getFollow("carol", "leaver"), undefined);
  assert.ok(r.getFollow("carol", "dave"));
  assert.equal(r.getProfileRow("leaver"), undefined);
  const left = openCommunityDb().prepare(`SELECT id FROM events WHERE id IN ('erase-e1', 'erase-e2', 'erase-e3')`).all().map((e) => e.id);
  assert.deepEqual(left, ["erase-e3"]);
});

test("feed settings are absent without a profile, default for a profile that never chose, and read back as written", () => {
  const r = repo();
  const at = "2026-09-01T00:00:00.000Z";
  assert.equal(r.getFeedSettings("chooser"), null);

  r.upsertProfile({ user_id: "chooser", published: 1, mural_id: "m1", published_at: at, updated_at: at, feed_settings: null });
  assert.deepEqual(r.getFeedSettings("chooser"), DEFAULT_FEED_SETTINGS);

  const chosen = { publications: false, reading: true, votes: false, follows: true, readerGlyph: true };
  r.updateFeedSettings("chooser", chosen);
  assert.deepEqual(r.getFeedSettings("chooser"), chosen);
  assert.equal(r.getProfileRow("chooser")?.feed_settings, JSON.stringify(chosen));
  assert.equal(r.getProfileRow("chooser")?.published, 1);
  assert.equal(r.getProfileRow("chooser")?.mural_id, "m1");

  r.updateFeedSettings("chooser", { publications: true, reading: false, votes: true, follows: false });
  assert.deepEqual(r.getFeedSettings("chooser"), { publications: true, reading: false, votes: true, follows: false, readerGlyph: false });
});

test("choosing feed settings before publishing creates a private profile that keeps them", () => {
  const r = repo();
  const chosen = { publications: false, reading: true, votes: false, follows: false, readerGlyph: true };
  r.updateFeedSettings("private-chooser", chosen);
  assert.deepEqual(r.getFeedSettings("private-chooser"), chosen);
  assert.equal(r.getProfileRow("private-chooser")?.published, 0);
});

test("listPublishedProfiles returns published rows newest update first and skips unpublished ones", () => {
  const r = repo();
  const at = (day: number) => `2026-11-0${day}T00:00:00.000Z`;
  r.upsertProfile({ user_id: "listed-a", published: 1, mural_id: null, published_at: at(1), updated_at: at(1), feed_settings: null });
  r.upsertProfile({ user_id: "listed-b", published: 1, mural_id: "m1", published_at: at(1), updated_at: at(3), feed_settings: null });
  r.upsertProfile({ user_id: "listed-hidden", published: 0, mural_id: null, published_at: null, updated_at: at(4), feed_settings: null });
  r.upsertProfile({ user_id: "listed-c", published: 1, mural_id: null, published_at: at(1), updated_at: at(2), feed_settings: null });
  assert.deepEqual(r.listPublishedProfiles(2).map((row) => row.user_id), ["listed-b", "listed-c"]);
  assert.deepEqual(r.listPublishedProfiles(3).map((row) => row.user_id), ["listed-b", "listed-c", "listed-a"]);
  assert.equal(r.listPublishedProfiles(2)[0]?.mural_id, "m1");
});

const CATEGORIES: FeedCategory[] = ["publications", "reading", "votes", "follows"];
const ALL_OFF = { publications: false, reading: false, votes: false, follows: false };

function openRepo() {
  const db = openCommunityDb();
  return { db, r: createSqliteCommunityRepository(db) };
}

function inboxRows(db: ReturnType<typeof openCommunityDb>, viewerId: string) {
  return db.prepare("SELECT created_at, event_id, author_id FROM feed_inbox WHERE viewer_id = ? ORDER BY created_at, event_id").all(viewerId).map((row) => ({ ...row }));
}

function inboxEventIds(db: ReturnType<typeof openCommunityDb>, viewerId: string) {
  return inboxRows(db, viewerId).map((row) => row.event_id);
}

test("an event is written to the inbox of each follower of its author, and of no one else", () => {
  const { db, r } = openRepo();
  const at = "2026-09-10T00:00:00.000Z";
  r.insertFollow({ follower_id: "fan-1", followee_id: "fan-author", created_at: at });
  r.insertFollow({ follower_id: "fan-2", followee_id: "fan-author", created_at: at });
  r.insertFollow({ follower_id: "fan-bystander", followee_id: "fan-other", created_at: at });
  r.insertEvent({ id: "fan-e1", user_id: "fan-author", type: "tierlist_published", ref_type: "tierlist", ref_id: "fan-t1", payload: null, created_at: "2026-09-11T00:00:00.000Z" });

  const row = { created_at: "2026-09-11T00:00:00.000Z", event_id: "fan-e1", author_id: "fan-author" };
  assert.deepEqual(inboxRows(db, "fan-1"), [row]);
  assert.deepEqual(inboxRows(db, "fan-2"), [row]);
  assert.deepEqual(inboxRows(db, "fan-bystander"), []);
  assert.deepEqual(inboxRows(db, "fan-author"), []);
});

test("only the five feed types reach an inbox", () => {
  const { db, r } = openRepo();
  r.insertFollow({ follower_id: "types-fan", followee_id: "types-author", created_at: "2026-09-10T00:00:00.000Z" });
  const types = [...FEED_EVENT_TYPES, "following", "mural_published"] as const;
  types.forEach((type, i) => {
    r.insertEvent({ id: `types-${type}`, user_id: "types-author", type, ref_type: "book", ref_id: `types-ref-${i}`, payload: null, created_at: `2026-09-11T00:00:0${i}.000Z` });
  });

  assert.deepEqual(inboxEventIds(db, "types-fan").sort(), FEED_EVENT_TYPES.map((type) => `types-${type}`).sort());
});

test("an event the unique indexes ignore is not fanned out", () => {
  const { db, r } = openRepo();
  r.insertFollow({ follower_id: "dup-fan", followee_id: "dup-author", created_at: "2026-09-10T00:00:00.000Z" });
  r.insertEvent({ id: "dup-pub-1", user_id: "dup-author", type: "tierlist_published", ref_type: "tierlist", ref_id: "dup-t1", payload: null, created_at: "2026-09-11T00:00:00.000Z" });
  r.insertEvent({ id: "dup-pub-2", user_id: "dup-author", type: "tierlist_published", ref_type: "tierlist", ref_id: "dup-t1", payload: null, created_at: "2026-09-12T00:00:00.000Z" });
  r.insertEvent({ id: "dup-vote-1", user_id: "dup-author", type: "voted_on", ref_type: "tierlist", ref_id: "dup-t2", payload: null, created_at: "2026-09-13T00:00:00.000Z" });
  r.insertEvent({ id: "dup-vote-2", user_id: "dup-author", type: "voted_on", ref_type: "tierlist", ref_id: "dup-t2", payload: null, created_at: "2026-09-14T00:00:00.000Z" });
  r.insertEvent({ id: "dup-vote-1", user_id: "dup-author", type: "voted_on", ref_type: "tierlist", ref_id: "dup-t3", payload: null, created_at: "2026-09-15T00:00:00.000Z" });

  assert.deepEqual(inboxEventIds(db, "dup-fan"), ["dup-pub-1", "dup-vote-1"]);
  assert.deepEqual(db.prepare("SELECT id FROM events WHERE user_id = 'dup-author' ORDER BY id").all().map((row) => row.id), ["dup-pub-1", "dup-vote-1"]);
});

test("following copies the author's feed events from the 30 days before the follow, and unfollowing takes them out again", () => {
  const { db, r } = openRepo();
  const event = (id: string, user: string, type: "tierlist_published" | "voted_on" | "book_added" | "following", at: string) =>
    r.insertEvent({ id, user_id: user, type, ref_type: "book", ref_id: id, payload: null, created_at: at });
  event("copy-old", "copy-author", "book_added", "2026-08-10T00:00:00.000Z");
  event("copy-edge", "copy-author", "voted_on", "2026-08-11T00:00:00.000Z");
  event("copy-recent", "copy-author", "book_added", "2026-09-05T00:00:00.000Z");
  event("copy-followed", "copy-author", "following", "2026-09-06T00:00:00.000Z");
  event("copy-other-author", "copy-other", "book_added", "2026-09-06T00:00:00.000Z");
  event("copy-stranger", "copy-stranger-author", "tierlist_published", "2026-09-06T00:00:00.000Z");

  assert.equal(r.insertFollow({ follower_id: "copier", followee_id: "copy-author", created_at: "2026-09-10T00:00:00.000Z" }), true);
  assert.equal(r.insertFollow({ follower_id: "copier", followee_id: "copy-other", created_at: "2026-09-10T00:00:00.000Z" }), true);
  assert.deepEqual(inboxEventIds(db, "copier"), ["copy-edge", "copy-recent", "copy-other-author"]);

  assert.equal(r.insertFollow({ follower_id: "copier", followee_id: "copy-author", created_at: "2026-09-20T00:00:00.000Z" }), false);
  assert.equal(inboxEventIds(db, "copier").length, 3);

  assert.equal(r.deleteFollow("copier", "copy-author"), true);
  assert.deepEqual(inboxEventIds(db, "copier"), ["copy-other-author"]);
  assert.equal(r.deleteFollow("copier", "copy-author"), false);
  assert.deepEqual(inboxEventIds(db, "copier"), ["copy-other-author"]);
  assert.deepEqual(inboxEventIds(db, "someone-else"), []);
});

test("the inbox reads newest first with ties split by id, continues after a keyset, and narrows to the requested types", () => {
  const { r } = openRepo();
  const at = (day: number) => `2026-09-0${day}T00:00:00.000Z`;
  r.insertFollow({ follower_id: "read-viewer", followee_id: "read-a", created_at: at(1) });
  r.insertFollow({ follower_id: "read-viewer", followee_id: "read-b", created_at: at(1) });
  const event = (id: string, user: string, type: "tierlist_published" | "tournament_published" | "voted_on", day: number) =>
    r.insertEvent({ id, user_id: user, type, ref_type: "book", ref_id: id, payload: `{"n":"${id}"}`, created_at: at(day), trace_id: `trace-${id}`, source: "GET /x" });
  event("read-1", "read-a", "tierlist_published", 1);
  event("read-2", "read-b", "voted_on", 2);
  event("read-3", "read-a", "tournament_published", 3);
  event("read-4", "read-b", "tierlist_published", 3);
  event("read-5", "read-a", "voted_on", 4);
  const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

  assert.deepEqual(ids(r.listInbox("read-viewer", undefined, 10, FEED_EVENT_TYPES)), ["read-5", "read-4", "read-3", "read-2", "read-1"]);
  assert.deepEqual(ids(r.listInbox("read-viewer", undefined, 2, FEED_EVENT_TYPES)), ["read-5", "read-4"]);
  assert.deepEqual(ids(r.listInbox("read-viewer", { createdAt: at(3), id: "read-4" }, 10, FEED_EVENT_TYPES)), ["read-3", "read-2", "read-1"]);
  assert.deepEqual(ids(r.listInbox("read-viewer", { createdAt: at(3), id: "read-3" }, 1, FEED_EVENT_TYPES)), ["read-2"]);
  assert.deepEqual(ids(r.listInbox("read-viewer", undefined, 10, ["voted_on"])), ["read-5", "read-2"]);
  assert.deepEqual(ids(r.listInbox("read-viewer", undefined, 10, ["tierlist_published", "tournament_published"])), ["read-4", "read-3", "read-1"]);
  assert.deepEqual(r.listInbox("read-viewer", undefined, 10, []), []);
  assert.deepEqual(r.listInbox("read-nobody", undefined, 10, FEED_EVENT_TYPES), []);
  assert.deepEqual({ ...r.listInbox("read-viewer", undefined, 1, FEED_EVENT_TYPES)[0] }, { id: "read-5", user_id: "read-a", type: "voted_on", ref_type: "book", ref_id: "read-5", payload: '{"n":"read-5"}', created_at: at(4), trace_id: "trace-read-5", source: "GET /x" });
});

test("countInboxSince counts the visible rows after the marker, stops at the limit, and narrows to the requested types", () => {
  const { r } = openRepo();
  const at = (day: number) => `2026-09-0${day}T00:00:00.000Z`;
  r.insertFollow({ follower_id: "count-viewer", followee_id: "count-author", created_at: at(1) });
  for (let day = 1; day <= 6; day++) r.insertEvent({ id: `count-p${day}`, user_id: "count-author", type: "tierlist_published", ref_type: "tierlist", ref_id: `count-t${day}`, payload: null, created_at: at(day) });
  for (let day = 4; day <= 6; day++) r.insertEvent({ id: `count-v${day}`, user_id: "count-author", type: "voted_on", ref_type: "tierlist", ref_id: `count-t${day}`, payload: null, created_at: at(day) });

  assert.equal(r.countInboxSince("count-viewer", "", FEED_EVENT_TYPES, 100), 9);
  assert.equal(r.countInboxSince("count-viewer", at(4), FEED_EVENT_TYPES, 100), 4);
  assert.equal(r.countInboxSince("count-viewer", "", ["voted_on"], 100), 3);
  assert.equal(r.countInboxSince("count-viewer", "", FEED_EVENT_TYPES, 5), 5);
  assert.equal(r.countInboxSince("count-viewer", at(6), FEED_EVENT_TYPES, 100), 0);
  assert.equal(r.countInboxSince("count-viewer", "", [], 100), 0);
  assert.equal(r.countInboxSince("count-nobody", "", FEED_EVENT_TYPES, 100), 0);
});

test("an author's switches are applied when the inbox is read, so hidden rows come back when shown again, and an author with no profile gets the defaults", () => {
  const { r } = openRepo();
  r.insertFollow({ follower_id: "shown-viewer", followee_id: "shown-chooser", created_at: "2026-09-01T00:00:00.000Z" });
  r.insertFollow({ follower_id: "shown-viewer", followee_id: "shown-plain", created_at: "2026-09-01T00:00:00.000Z" });
  for (const author of ["shown-chooser", "shown-plain"]) {
    FEED_EVENT_TYPES.forEach((type, i) => r.insertEvent({ id: `${author}-${type}`, user_id: author, type, ref_type: "book", ref_id: `${author}-${type}`, payload: null, created_at: `2026-09-0${i + 2}T00:00:00.000Z` }));
  }
  const seen = (author: string) => r.listInbox("shown-viewer", undefined, 50, FEED_EVENT_TYPES).filter((event) => event.user_id === author).map((event) => event.type).sort();
  const typesOf = (category: FeedCategory) => FEED_EVENT_TYPES.filter((type) => categoryFor(type) === category).sort();
  const everyRowVisible = () => r.listInbox("shown-viewer", undefined, 50, FEED_EVENT_TYPES).length;

  assert.deepEqual(seen("shown-plain"), FEED_EVENT_TYPES.filter((type) => DEFAULT_FEED_SETTINGS[categoryFor(type)]).sort());
  const plainRows = seen("shown-plain").length;
  assert.ok(plainRows > 0 && plainRows < FEED_EVENT_TYPES.length);

  assert.deepEqual(seen("shown-chooser"), FEED_EVENT_TYPES.filter((type) => DEFAULT_FEED_SETTINGS[categoryFor(type)]).sort());
  r.updateFeedSettings("shown-chooser", ALL_OFF);
  assert.deepEqual(seen("shown-chooser"), []);
  assert.equal(r.countInboxSince("shown-viewer", "", FEED_EVENT_TYPES, 100), plainRows);

  for (const category of CATEGORIES) {
    r.updateFeedSettings("shown-chooser", { ...ALL_OFF, [category]: true });
    assert.deepEqual(seen("shown-chooser"), typesOf(category), category);
    assert.equal(r.countInboxSince("shown-viewer", "", FEED_EVENT_TYPES, 100), everyRowVisible(), category);
  }
  assert.deepEqual(typesOf("follows"), []);

  r.updateFeedSettings("shown-chooser", { publications: true, reading: true, votes: true, follows: false });
  assert.deepEqual(seen("shown-chooser"), [...FEED_EVENT_TYPES].sort());
  assert.equal(r.countInboxSince("shown-viewer", "", FEED_EVENT_TYPES, 100), plainRows + FEED_EVENT_TYPES.length);
});

test("deleting a user's data clears their inbox as viewer and as author, and their history, and leaves everyone else's", () => {
  const { db, r } = openRepo();
  const at = "2026-09-10T00:00:00.000Z";
  r.insertFollow({ follower_id: "gone", followee_id: "kept-author", created_at: at });
  r.insertFollow({ follower_id: "kept-fan", followee_id: "gone", created_at: at });
  r.insertFollow({ follower_id: "kept-fan", followee_id: "kept-author", created_at: at });
  r.insertEvent({ id: "gone-own", user_id: "gone", type: "book_added", ref_type: "book", ref_id: "gone-b", payload: null, created_at: at });
  r.insertEvent({ id: "kept-own", user_id: "kept-author", type: "book_added", ref_type: "book", ref_id: "kept-b", payload: null, created_at: at });
  const history = db.prepare("INSERT INTO events_history (id, user_id, type, ref_type, ref_id, payload, created_at, trace_id, source) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL)");
  history.run("history-gone", "gone", "book_added", "book", "gone-old", at);
  history.run("history-about-gone", "kept-fan", "following", "user", "gone", at);
  history.run("history-kept", "kept-author", "following", "user", "kept-fan", at);
  assert.deepEqual(inboxEventIds(db, "gone"), ["kept-own"]);
  assert.deepEqual(inboxEventIds(db, "kept-fan"), ["gone-own", "kept-own"]);

  r.deleteUserData("gone");

  assert.deepEqual(inboxEventIds(db, "gone"), []);
  assert.deepEqual(inboxEventIds(db, "kept-fan"), ["kept-own"]);
  assert.deepEqual(db.prepare("SELECT id FROM events_history WHERE id LIKE 'history-%'").all().map((row) => row.id), ["history-kept"]);
  assert.deepEqual(db.prepare("SELECT id FROM events WHERE id IN ('gone-own', 'kept-own')").all().map((row) => row.id), ["kept-own"]);
});
