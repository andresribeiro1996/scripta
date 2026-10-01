import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

const tempRoot = mkdtempSync(join(tmpdir(), "community-repo-"));
process.env.JWT_ACCESS_SECRET = "a".repeat(64);
process.env.JWT_REFRESH_SECRET = "b".repeat(64);
process.env.AUTH_DB_PATH = join(tempRoot, "auth.sqlite");
process.env.LIBRARY_DB_PATH = join(tempRoot, "library.sqlite");
process.env.GALLERY_DB_PATH = join(tempRoot, "gallery.sqlite");
process.env.COMMUNITY_DB_PATH = join(tempRoot, "community.sqlite");

const { openCommunityDb } = await import("./connection.js");
const { createSqliteCommunityRepository } = await import("./sqliteCommunityRepository.js");

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
