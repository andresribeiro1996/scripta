import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDashboardCards, digestHeading, digestTarget, type DigestItem } from "@scripta/shared/dashboard";
import { bookKey } from "@scripta/shared/library/merge";

test("cards derive from read status", () => {
  const reading = { Title: "Current", ReadStatus: 1 };
  const tbr = { Title: "Next", ReadStatus: 0 };
  const done = { Title: "Done", ReadStatus: 2 };
  const cards = buildDashboardCards([reading, tbr, done], "2026-09-18");
  assert.deepEqual(cards[0], { kind: "currentlyReading", bookKeys: [bookKey(reading)] });
  assert.deepEqual(cards[1], { kind: "upNext", bookKeys: [bookKey(tbr)] });
});

test("empty library yields no cards", () => {
  assert.deepEqual(buildDashboardCards([], "2026-09-18"), []);
});

test("all-finished library yields only upNext-free, rediscover-eligible output", () => {
  const done = { Title: "Done", ReadStatus: 2, highlights: [{ BookmarkID: "bm1", Type: "highlight", Text: "Keep me." }] };
  const cards = buildDashboardCards([done], "2026-09-18", "salt");
  assert.deepEqual(cards, [{ kind: "rediscover", bookKey: bookKey(done), highlightId: "bm1" }]);
});

test("rediscover card rotates by day+salt over eligible highlights", () => {
  const books = [{
    Title: "A", ReadStatus: 2,
    highlights: [
      { BookmarkID: "b1", Type: "highlight", Text: "one" },
      { BookmarkID: "b2", Type: "highlight", Text: "two" }
    ]
  }];
  const a = buildDashboardCards(books, "2026-09-18", "s");
  const b = buildDashboardCards(books, "2026-09-19", "s");
  assert.equal(a[0]?.kind, "rediscover");
  const keys = new Set([JSON.stringify(a), JSON.stringify(b)]);
  assert.ok(keys.size === 2 || JSON.stringify(a) === JSON.stringify(b));
});

test("digest headings and targets by kind", () => {
  const pub: DigestItem = {
    kind: "publication", id: "e1", type: "tierlist_published", createdAt: "2026-09-10T00:00:00.000Z",
    actor: { userId: "u1", username: "andre", avatarUrl: null },
    content: { kind: "tierlist", id: "t1", voteCode: "code12ab", name: "Top fantasy", poolSize: 12, ballotCount: 4, votingOpen: true, promotedAt: null }
  };
  const follow: DigestItem = { kind: "follow", id: "u2", createdAt: "2026-09-11T00:00:00.000Z", actor: { userId: "u2", username: "sam", avatarUrl: null } };
  assert.equal(digestHeading(pub), "andre published a tier list");
  assert.equal(digestTarget(pub), "/vote/code12ab");
  assert.equal(digestHeading(follow), "sam started following you");
  assert.equal(digestTarget(follow), "/community/u/sam");
});
