import assert from "node:assert/strict";
import { test } from "node:test";
import type { DigestItem } from "@scripta/shared";
import { feedRowModel, relativeTime } from "./feedRow.js";

const actor = { userId: "u1", username: "alice", avatarUrl: null };

const tierlist = {
  kind: "tierlist" as const,
  id: "t1",
  voteCode: "abc",
  name: "Fantasy doorstoppers",
  poolSize: 24,
  ballotCount: 7,
  votingOpen: true,
  promotedAt: null,
  covers: ["a.png", "b.png"]
};

test("a publication leads with the thing published, not the sentence", () => {
  const row = feedRowModel({ kind: "publication", id: "e1", actor, type: "tierlist_published", content: tierlist, createdAt: "2026-09-17T00:00:00.000Z" });
  assert.equal(row.title, "Fantasy doorstoppers");
  assert.equal(row.label, "Tier list");
  assert.equal(row.icon, "tierlist");
  assert.equal(row.meta, "alice · 24 books · 7 ballots");
  assert.deepEqual(row.covers, ["a.png", "b.png"]);
});

test("a vote is its own headline, so it carries no title and no covers", () => {
  const row = feedRowModel({ kind: "vote", id: "e2", actor, content: tierlist, createdAt: "2026-09-17T00:00:00.000Z" });
  assert.equal(row.title, "");
  assert.equal(row.label, "Ranked");
  assert.equal(row.icon, "vote");
  assert.deepEqual(row.covers, []);
  // The ranked list still has covers of its own — a vote just doesn't earn
  // the same visual weight as publishing one.
  assert.equal(row.meta, "alice · Fantasy doorstoppers");
});

test("a finished book shows its one cover and reads as done", () => {
  const item: DigestItem = { kind: "reading", id: "e3", actor, book: { title: "Hyperion", author: "Dan Simmons", coverUrl: "h.png" }, finished: true, createdAt: "2026-09-17T00:00:00.000Z" };
  const row = feedRowModel(item);
  assert.equal(row.label, "Finished");
  assert.equal(row.icon, "book");
  assert.equal(row.tone, "success");
  assert.deepEqual(row.covers, ["h.png"]);
  assert.equal(row.title, "Hyperion");
});

test("a book with no cover falls back to the avatar slot", () => {
  const row = feedRowModel({ kind: "reading", id: "e4", actor, book: { title: "Untitled", author: "", coverUrl: null }, finished: false, createdAt: "2026-09-17T00:00:00.000Z" });
  assert.deepEqual(row.covers, []);
  assert.equal(row.meta, "alice");
});

test("relative time stays relative only while that is easier to read", () => {
  const now = Date.parse("2026-09-19T12:00:00.000Z");
  assert.equal(relativeTime("2026-09-19T11:59:40.000Z", now), "now");
  assert.equal(relativeTime("2026-09-19T11:30:00.000Z", now), "30m ago");
  assert.equal(relativeTime("2026-09-19T04:00:00.000Z", now), "8h ago");
  assert.equal(relativeTime("2026-09-17T12:00:00.000Z", now), "2d ago");
  // Past a month the count stops helping, so it becomes a plain date.
  assert.match(relativeTime("2025-01-05T12:00:00.000Z", now), /2025/);
});

test("a clock skewed into the future reads as now, never as negative", () => {
  const now = Date.parse("2026-09-19T12:00:00.000Z");
  assert.equal(relativeTime("2026-09-19T12:05:00.000Z", now), "now");
  assert.equal(relativeTime("not a date", now), "");
});

test("a new follower who isn't followed back offers the one action a row has", () => {
  const stranger = feedRowModel({ kind: "follow", id: "f1", actor, createdAt: "2026-09-17T00:00:00.000Z", viewerFollows: false });
  assert.equal(stranger.action, "followBack");
  // Already mutual: there is nothing left to offer, so the row is a link again.
  const mutual = feedRowModel({ kind: "follow", id: "f2", actor, createdAt: "2026-09-17T00:00:00.000Z", viewerFollows: true });
  assert.equal(mutual.action, null);
});

test("no other row kind carries an action", () => {
  assert.equal(feedRowModel({ kind: "publication", id: "e1", actor, type: "tierlist_published", content: tierlist, createdAt: "2026-09-17T00:00:00.000Z" }).action, null);
  assert.equal(feedRowModel({ kind: "vote", id: "e2", actor, content: tierlist, createdAt: "2026-09-17T00:00:00.000Z" }).action, null);
  assert.equal(feedRowModel({ kind: "reading", id: "e3", actor, book: { title: "Hyperion", author: "Dan Simmons", coverUrl: null }, finished: true, createdAt: "2026-09-17T00:00:00.000Z" }).action, null);
});
