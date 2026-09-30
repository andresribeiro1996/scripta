import assert from "node:assert/strict";
import { test } from "node:test";
import type { DigestItem } from "./dashboard.js";
import { digestAction, digestHeading, upNextPair } from "./dashboard.js";

const actor = { userId: "u1", username: "alice", avatarUrl: null };
const tierlist = { kind: "tierlist" as const, id: "t1", voteCode: "abc", name: "Fantasy doorstoppers", poolSize: 5, ballotCount: 1, votingOpen: true, promotedAt: null, covers: [] };

test("digestHeading is the actor's username followed by digestAction, for every kind", () => {
  const items: DigestItem[] = [
    { kind: "publication", id: "e1", actor, type: "tierlist_published", content: tierlist, createdAt: "2026-09-17T00:00:00.000Z" },
    { kind: "vote", id: "e2", actor, content: tierlist, createdAt: "2026-09-17T00:00:00.000Z" },
    { kind: "reading", id: "e3", actor, book: { title: "Hyperion", author: "Dan Simmons", coverUrl: null }, finished: true, createdAt: "2026-09-17T00:00:00.000Z" },
    { kind: "follow", id: "e4", actor, createdAt: "2026-09-17T00:00:00.000Z", viewerFollows: false }
  ];
  for (const item of items) {
    assert.equal(digestHeading(item), `${actor.username} ${digestAction(item)}`);
  }
  assert.equal(digestAction(items[0]!), "published a tier list");
  assert.equal(digestAction(items[1]!), "ranked books on Fantasy doorstoppers");
  assert.equal(digestAction(items[2]!), "finished Hyperion");
  assert.equal(digestAction(items[3]!), "started following you");
});

test("two keys pairs both, at any offset", () => {
  const keys = ["a", "b"];
  assert.deepEqual(upNextPair(keys, 0), ["a", "b"]);
  assert.deepEqual(upNextPair(keys, 1), ["b", "a"]);
});

test("six keys step through three pairs then wrap to the first", () => {
  const keys = ["k0", "k1", "k2", "k3", "k4", "k5"];
  assert.deepEqual(upNextPair(keys, 0), ["k0", "k1"]);
  assert.deepEqual(upNextPair(keys, 2), ["k2", "k3"]);
  assert.deepEqual(upNextPair(keys, 4), ["k4", "k5"]);
  assert.deepEqual(upNextPair(keys, 6), ["k0", "k1"]);
});

test("an odd count wraps mid-pair", () => {
  const keys = ["k0", "k1", "k2", "k3", "k4"];
  assert.deepEqual(upNextPair(keys, 4), ["k4", "k0"]);
});

test("fewer than two keys yields no pair", () => {
  assert.deepEqual(upNextPair(["only"], 0), []);
  assert.deepEqual(upNextPair([], 0), []);
});
