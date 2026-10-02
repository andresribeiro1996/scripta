import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { categoryFor, DEFAULT_FEED_SETTINGS, type ActivityEventType, type FeedCategory } from "@scripta/shared/community";
import { registerTrace } from "../../../../trace.js";
import { ACTIVITY_EVENT_TYPES, FEED_EVENT_TYPES } from "../../domain/feed.js";
import type { EventRow } from "../../domain/types.js";
import type { PublishedTierlistRef } from "../../../tierlists/service.js";

const tempRoot = mkdtempSync(join(tmpdir(), "community-repo-"));
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);
process.env.AUTH_DB_PATH = join(tempRoot, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(tempRoot, "library.sqlite");
process.env.GALLERY_DB_PATH = join(tempRoot, "gallery.sqlite");
process.env.COMMUNITY_DB_PATH = join(tempRoot, "community.sqlite");

const { openCommunityDb } = await import("./connection.js");
const { createSqliteCommunityRepository } = await import("./sqliteCommunityRepository.js");
const { createCommunityPublicApi, createCommunityService } = await import("../../service.js");

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
  assert.equal(r.listEventsByUser("alice", undefined, 10, []).length, 2);

  const page = r.listEventsByUser("alice", { createdAt: "2026-09-02T00:00:00.000Z", id: "e1" }, 10, []);
  assert.deepEqual(page.map((e) => e.id), ["e3"]);
  assert.deepEqual(r.listEventsByUser("bob", undefined, 10, []), []);
});

test("an event keeps the trace that caused it, or nulls when it was given none", () => {
  const r = repo();
  r.insertEvent({ id: "trace-e1", user_id: "traced", type: "tierlist_published", ref_type: "tierlist", ref_id: "trace-t1", payload: null, created_at: "2026-09-02T00:00:00.000Z", trace_id: "req-1", source: "POST /tierlists/:id/open-voting" });
  r.insertEvent({ id: "trace-e2", user_id: "traced", type: "tournament_published", ref_type: "tournament", ref_id: "trace-g1", payload: null, created_at: "2026-09-01T00:00:00.000Z" });

  assert.deepEqual(r.listEventsByUser("traced", undefined, 10, []).map((e) => [e.id, e.trace_id, e.source]), [
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

test("moveEventsBefore moves the oldest events first, up to the batch, with every column, and keeps newer ones until the cutoff passes them", () => {
  const { db, r } = openRepo();
  const at = (day: number) => `1999-03-${String(day).padStart(2, "0")}T00:00:00.000Z`;
  const event = (id: string, day: number, trace?: { traceId: string; source: string }): EventRow => ({
    id,
    user_id: "move-author",
    type: "book_added",
    ref_type: "book",
    ref_id: id,
    payload: `{"title":"${id}"}`,
    created_at: at(day),
    trace_id: trace?.traceId ?? null,
    source: trace?.source ?? null
  });
  const first = event("move-a", 1, { traceId: "req-a", source: "POST /library/books" });
  const tiedLow = event("move-b1", 2, { traceId: "req-b1", source: "PUT /library" });
  const tiedHigh = event("move-b2", 2);
  const third = event("move-d", 4, { traceId: "req-d", source: "PUT /library" });
  const newest = event("move-e", 9);
  for (const row of [third, tiedLow, first, newest, tiedHigh]) r.insertEvent(row);
  const stored = (table: "events" | "events_history") => db.prepare(`SELECT * FROM ${table} WHERE user_id = 'move-author' ORDER BY created_at, id`).all().map((row) => ({ ...row }));

  assert.equal(r.moveEventsBefore(at(5), 2), 2);
  assert.deepEqual(stored("events_history"), [first, tiedLow]);
  assert.deepEqual(stored("events"), [tiedHigh, third, newest]);
  assert.equal(r.moveEventsBefore(at(5), 2), 2);
  assert.equal(r.moveEventsBefore(at(5), 2), 0);
  assert.deepEqual(stored("events_history"), [first, tiedLow, tiedHigh, third]);
  assert.deepEqual(stored("events"), [newest]);
  assert.equal(r.moveEventsBefore(at(9), 2), 0);

  const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);
  assert.deepEqual(ids(r.listHistoryEventsByUser("move-author", undefined, 10, [])), ["move-d", "move-b2", "move-b1", "move-a"]);
  assert.deepEqual(ids(r.listHistoryEventsByUser("move-author", { createdAt: at(2), id: "move-b2" }, 1, [])), ["move-b1"]);
  assert.deepEqual(ids(r.listHistoryEventsByUser("move-author", { createdAt: at(2), id: "move-b1" }, 10, [])), ["move-a"]);
  assert.deepEqual(r.listHistoryEventsByUser("move-nobody", undefined, 10, []), []);
  assert.deepEqual(ids(r.listEventsByUser("move-author", undefined, 10, [])), ["move-e"]);

  assert.equal(r.moveEventsBefore(at(10), 2), 1);
  assert.deepEqual(stored("events"), []);
});

test("hiddenTypes leaves its types out of a user's events and of their history, on the first page and after a keyset, and an empty list leaves nothing out", () => {
  const { db, r } = openRepo();
  const insertHistory = db.prepare("INSERT INTO events_history (id, user_id, type, ref_type, ref_id, payload, created_at, trace_id, source) VALUES (?, ?, ?, 'book', ?, NULL, ?, NULL, NULL)");
  const at = (day: number) => `2026-08-${String(day).padStart(2, "0")}T00:00:00.000Z`;
  const hiddenBooks: ActivityEventType[] = ["book_added", "book_finished"];
  const rows = [["9b", "voted_on", 9], ["9a", "following", 9], ["8b", "book_added", 8], ["8a", "mural_published", 8], ["7", "book_finished", 7], ["6b", "tierlist_published", 6], ["6a", "book_added", 6], ["5", "book_added", 5], ["4", "voted_on", 4]] as const;
  const stores = [
    { user: "hide-hot", insert: (id: string, type: ActivityEventType, day: number) => r.insertEvent({ id, user_id: "hide-hot", type, ref_type: "book", ref_id: id, payload: null, created_at: at(day) }), list: r.listEventsByUser },
    { user: "hide-old", insert: (id: string, type: ActivityEventType, day: number) => void insertHistory.run(id, "hide-old", type, id, at(day)), list: r.listHistoryEventsByUser }
  ];

  for (const { user, insert, list } of stores) {
    for (const [id, type, day] of rows) insert(`${user}-${id}`, type, day);
    const ids = (page: EventRow[]) => page.map((row) => row.id.slice(user.length + 1));
    const after = (day: number, id: string) => ({ createdAt: at(day), id: `${user}-${id}` });
    const pagesOf = (limit: number) => {
      const found: string[] = [];
      let keyset: { createdAt: string; id: string } | undefined;
      for (let pages = 0; pages < 20; pages++) {
        const page = list(user, keyset, limit, hiddenBooks);
        const last = page[page.length - 1];
        if (!last) break;
        found.push(...ids(page));
        keyset = { createdAt: last.created_at, id: last.id };
      }
      return found;
    };

    assert.deepEqual(ids(list(user, undefined, 20, [])), ["9b", "9a", "8b", "8a", "7", "6b", "6a", "5", "4"], `${user}: nothing hidden`);
    assert.deepEqual(ids(list(user, after(8, "8b"), 20, [])), ["8a", "7", "6b", "6a", "5", "4"], `${user}: nothing hidden, after a keyset`);
    assert.deepEqual(ids(list(user, undefined, 20, hiddenBooks)), ["9b", "9a", "8a", "6b", "4"], `${user}: books hidden`);
    assert.deepEqual(ids(list(user, undefined, 3, hiddenBooks)), ["9b", "9a", "8a"], `${user}: hidden rows do not use up the limit`);
    assert.deepEqual(ids(list(user, after(8, "8b"), 20, hiddenBooks)), ["8a", "6b", "4"], `${user}: books hidden, after a hidden row`);
    assert.deepEqual(ids(list(user, after(6, "6b"), 20, hiddenBooks)), ["4"], `${user}: books hidden, after a visible row`);
    assert.deepEqual(ids(list(user, undefined, 20, ["voted_on"])), ["9a", "8b", "8a", "7", "6b", "6a", "5"], `${user}: votes hidden`);
    assert.deepEqual(list(user, undefined, 20, ACTIVITY_EVENT_TYPES), [], `${user}: every type hidden`);
    assert.deepEqual(list(user, after(9, "9b"), 20, ACTIVITY_EVENT_TYPES), [], `${user}: every type hidden, after a keyset`);
    for (const limit of [1, 2, 3]) assert.deepEqual(pagesOf(limit), ["9b", "9a", "8a", "6b", "4"], `${user}: limit ${limit}`);
  }
});

test("purgeInboxBefore deletes the oldest inbox rows of every viewer up to the batch, keeps newer ones, and leaves the events alone", () => {
  const { db, r } = openRepo();
  const at = (day: number) => `1998-03-${String(day).padStart(2, "0")}T00:00:00.000Z`;
  for (const fan of ["purge-fan-1", "purge-fan-2"]) r.insertFollow({ follower_id: fan, followee_id: "purge-author", created_at: "2026-09-10T00:00:00.000Z" });
  for (const day of [1, 2, 3, 9]) r.insertEvent({ id: `purge-${day}`, user_id: "purge-author", type: "tierlist_published", ref_type: "tierlist", ref_id: `purge-t${day}`, payload: null, created_at: at(day) });

  assert.equal(r.purgeInboxBefore(at(5), 4), 4);
  assert.equal(r.purgeInboxBefore(at(5), 4), 2);
  assert.equal(r.purgeInboxBefore(at(5), 4), 0);
  assert.deepEqual(inboxEventIds(db, "purge-fan-1"), ["purge-9"]);
  assert.deepEqual(inboxEventIds(db, "purge-fan-2"), ["purge-9"]);
  assert.deepEqual(db.prepare("SELECT id FROM events WHERE user_id = 'purge-author' ORDER BY id").all().map((row) => row.id), ["purge-1", "purge-2", "purge-3", "purge-9"]);

  assert.equal(r.purgeInboxBefore(at(10), 4), 2);
  assert.equal(r.moveEventsBefore(at(10), 10), 4);
});

test("the dashboard service pages through a real inbox newest first, narrowed to the kinds listed, with the authors' switches and the new count applied", () => {
  const { r } = openRepo();
  const unused = () => {
    throw new Error("the dashboard does not read this");
  };
  const refs = new Map<string, PublishedTierlistRef>();
  for (const [id, owner] of [["dash-t-a1", "dash-a"], ["dash-t-b1", "dash-b"], ["dash-t-b2", "dash-b"]]) {
    refs.set(id!, { id: id!, ownerUserId: owner!, createdAt: "2026-09-01T00:00:00.000Z", voteCode: `code-${id}`, name: id!, poolSize: 3, ballotCount: 0, eligibleVoteCount: 0, promotedAt: null, votingOpen: true, covers: [] });
  }
  const seen: { at: string | null } = { at: null };
  const service = createCommunityService({
    repo: r,
    getDashboardSeenAt: () => seen.at,
    setDashboardSeenAt: unused,
    resolveProfile: unused,
    resolveProfiles: (ids) => new Map(ids.map((id) => [id, { username: id, avatarUrl: null }])),
    resolveLibrary: unused,
    readerGlyphFor: () => null,
    sharedBookCounts: unused,
    sharedBooks: unused,
    userHasUsername: unused,
    findUserIdByUsername: unused,
    searchUsernameOwners: unused,
    murals: { ownsMural: unused, getMuralPublicPayload: unused },
    tierlists: { discoverWindow: unused, getPublishedMany: unused, votedAmong: unused, get: (id) => refs.get(id), listByOwner: unused },
    tournaments: { discoverWindow: unused, getPublishedMany: unused, votedAmong: unused, get: () => undefined, listByOwner: unused },
    participation: { tierlists: () => [], tournaments: () => [], quizzes: () => [] }
  });
  const at = (day: number) => `2026-09-0${day}T00:00:00.000Z`;
  const event = (id: string, user: string, type: "tierlist_published" | "voted_on" | "book_added", refId: string, day: number) =>
    r.insertEvent({ id, user_id: user, type, ref_type: type === "book_added" ? "book" : "tierlist", ref_id: refId, payload: type === "book_added" ? '{"title":"Dune","author":"Herbert"}' : null, created_at: at(day) });
  r.insertFollow({ follower_id: "dash-viewer", followee_id: "dash-a", created_at: at(1) });
  r.insertFollow({ follower_id: "dash-viewer", followee_id: "dash-b", created_at: at(1) });
  event("dash-pub-a1", "dash-a", "tierlist_published", "dash-t-a1", 5);
  event("dash-pub-b1", "dash-b", "tierlist_published", "dash-t-b1", 4);
  event("dash-vote-a", "dash-a", "voted_on", "dash-t-b1", 3);
  event("dash-pub-b2", "dash-b", "tierlist_published", "dash-t-b2", 2);
  event("dash-read-a", "dash-a", "book_added", "dash-book", 6);
  const ids = (kinds?: ReadonlySet<string>) => {
    const found: string[] = [];
    let cursor: string | undefined;
    do {
      const page = service.getDashboard("dash-viewer", cursor, 2, kinds);
      assert.ok(page.items.length <= 2);
      found.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return found;
  };

  assert.deepEqual(ids(), ["dash-pub-a1", "dash-pub-b1", "dash-vote-a", "dash-pub-b2"]);
  assert.deepEqual(ids(new Set(["vote"])), ["dash-vote-a"]);
  assert.deepEqual(ids(new Set(["publication", "follow"])), ["dash-pub-a1", "dash-pub-b1", "dash-pub-b2"]);
  assert.equal(service.getDashboard("dash-viewer", undefined, 20).followingNewCount, 4);
  seen.at = at(4);
  assert.equal(service.getDashboard("dash-viewer", undefined, 20).followingNewCount, 1);
  seen.at = null;

  r.updateFeedSettings("dash-b", { ...DEFAULT_FEED_SETTINGS, publications: false });
  r.updateFeedSettings("dash-a", { ...DEFAULT_FEED_SETTINGS, reading: true });
  assert.deepEqual(ids(), ["dash-read-a", "dash-pub-a1", "dash-vote-a"]);
  assert.equal(service.getDashboard("dash-viewer", undefined, 20).followingNewCount, 3);

  r.deleteFollow("dash-viewer", "dash-a");
  assert.deepEqual(ids(), []);
});

test("an event, a follow and an unfollow are each written together with their inbox rows or not at all", (t) => {
  const { db, r } = openRepo();
  t.after(() => db.exec("DROP TRIGGER IF EXISTS atomic_block"));
  const at = "2026-09-10T00:00:00.000Z";
  const event = { id: "atomic-e1", user_id: "atomic-author", type: "book_added" as const, ref_type: "book" as const, ref_id: "atomic-b1", payload: null, created_at: at };
  r.insertFollow({ follower_id: "atomic-fan", followee_id: "atomic-author", created_at: at });

  db.exec("CREATE TRIGGER atomic_block BEFORE INSERT ON feed_inbox WHEN NEW.event_id = 'atomic-e1' BEGIN SELECT RAISE(ABORT, 'blocked'); END");
  assert.throws(() => r.insertEvent(event), /blocked/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE id = 'atomic-e1'").get()?.n, 0);

  db.exec("DROP TRIGGER atomic_block");
  r.insertEvent(event);
  db.exec("CREATE TRIGGER atomic_block BEFORE INSERT ON feed_inbox WHEN NEW.viewer_id = 'atomic-late' BEGIN SELECT RAISE(ABORT, 'blocked'); END");
  assert.throws(() => r.insertFollow({ follower_id: "atomic-late", followee_id: "atomic-author", created_at: at }), /blocked/);
  assert.equal(r.getFollow("atomic-late", "atomic-author"), undefined);

  db.exec("DROP TRIGGER atomic_block");
  db.exec("CREATE TRIGGER atomic_block BEFORE DELETE ON feed_inbox BEGIN SELECT RAISE(ABORT, 'blocked'); END");
  assert.throws(() => r.deleteFollow("atomic-fan", "atomic-author"), /blocked/);
  assert.notEqual(r.getFollow("atomic-fan", "atomic-author"), undefined);
});

test("unfollowing removes only the unfollower's inbox rows of that author", () => {
  const { db, r } = openRepo();
  const at = "2026-09-10T00:00:00.000Z";
  r.insertFollow({ follower_id: "un-a", followee_id: "un-author", created_at: at });
  r.insertFollow({ follower_id: "un-b", followee_id: "un-author", created_at: at });
  r.insertEvent({ id: "un-e1", user_id: "un-author", type: "book_added", ref_type: "book", ref_id: "un-b1", payload: null, created_at: at });

  r.deleteFollow("un-a", "un-author");

  assert.deepEqual(inboxEventIds(db, "un-a"), []);
  assert.deepEqual(inboxEventIds(db, "un-b"), ["un-e1"]);
});
