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
