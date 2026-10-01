import assert from "node:assert/strict";
import { test } from "node:test";
import type { DigestItem, ParticipationItem } from "./dashboard.js";
import { clearDashboardCounts, dashboardQuery, digestAction, digestHeading, digestTarget, isNewDigestItem, newCountLabel, participationLead, upNextPair, withKnownDigestItems } from "./dashboard.js";

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

const participation = (overrides: Partial<ParticipationItem> = {}): ParticipationItem => ({
  kind: "participation",
  id: "tierlist:t1",
  game: { kind: "tierlist", id: "t1", name: "Sci-fi", covers: [] },
  actors: [],
  count: 1,
  createdAt: "2026-09-30T10:00:00.000Z",
  ...overrides
});
const named = (username: string) => ({ userId: username, username, avatarUrl: null });

test("participationLead names up to three readers and counts the rest", () => {
  assert.equal(participationLead(participation({ count: 5 })), "5 people");
  assert.equal(participationLead(participation({ count: 1 })), "1 person");
  assert.equal(participationLead(participation({ actors: [named("ana")], count: 1 })), "ana");
  assert.equal(participationLead(participation({ actors: [named("ana"), named("rui")], count: 2 })), "ana and rui");
  assert.equal(participationLead(participation({ actors: [named("ana"), named("rui"), named("bo")], count: 3 })), "ana, rui and bo");
  assert.equal(participationLead(participation({ actors: [named("ana"), named("rui")], count: 3 })), "ana, rui and 1 other");
  assert.equal(participationLead(participation({ actors: [named("ana"), named("rui")], count: 12 })), "ana, rui and 10 others");
});

test("participation rows say what happened to which game, and link to the owner's view", () => {
  const tier = participation({ actors: [named("ana")], count: 4 });
  assert.equal(digestAction(tier), "ranked your tier list Sci-fi");
  assert.equal(digestHeading(tier), "ana and 3 others ranked your tier list Sci-fi");
  assert.equal(digestTarget(tier), "/dashboard/arena/tierlist/t1");
  const cup = participation({ id: "tournament:g1", game: { kind: "tournament", id: "g1", name: "Cup", covers: [] }, count: 2 });
  assert.equal(digestHeading(cup), "2 people voted in your tournament Cup");
  assert.equal(digestTarget(cup), "/arena/g1");
  const quiz = participation({ id: "quiz:q1", game: { kind: "quiz", id: "q1", name: "Covers", covers: [] }, actors: [named("bo")], count: 1 });
  assert.equal(digestHeading(quiz), "bo played your quiz Covers");
  assert.equal(digestTarget(quiz), "/dashboard/arena/quiz/q1");
});

test("newCountLabel hides zero and caps at 99+", () => {
  assert.equal(newCountLabel(0), null);
  assert.equal(newCountLabel(7), "7");
  assert.equal(newCountLabel(99), "99");
  assert.equal(newCountLabel(100), "99+");
});

test("a row is new when it came after the seen marker, or when there is none", () => {
  const item = participation({ createdAt: "2026-09-30T10:00:00.000Z" });
  assert.equal(isNewDigestItem(item, null), true);
  assert.equal(isNewDigestItem(item, "2026-09-30T09:00:00.000Z"), true);
  assert.equal(isNewDigestItem(item, "2026-09-30T10:00:00.000Z"), false);
});

test("clearing the counts keeps the rows and the seen marker", () => {
  const page = { items: [participation()], nextCursor: null, seenAt: "2026-09-30T09:00:00.000Z", personalNewCount: 3, followingNewCount: 2 };
  const cleared = clearDashboardCounts({ pages: [page, { ...page, personalNewCount: 0, followingNewCount: 0 }], pageParams: [undefined, "c"] });
  assert.equal(cleared.pages[0]!.personalNewCount, 0);
  assert.equal(cleared.pages[0]!.followingNewCount, 0);
  assert.equal(cleared.pages[0]!.seenAt, page.seenAt);
  assert.equal(cleared.pages[0]!.items.length, 1);
  assert.deepEqual(cleared.pageParams, [undefined, "c"]);
});

test("a row of a kind this build doesn't know is dropped, and everything else on the page is kept", () => {
  const follow: DigestItem = { kind: "follow", id: "e4", actor, createdAt: "2026-09-17T00:00:00.000Z", viewerFollows: false };
  const reply = { kind: "reply", id: "r1", actor, createdAt: "2026-09-18T00:00:00.000Z" } as unknown as DigestItem;
  const page = { items: [reply, follow, participation()], nextCursor: "c1", seenAt: "2026-09-16T00:00:00.000Z", personalNewCount: 2, followingNewCount: 1 };
  assert.deepEqual(withKnownDigestItems(page), { ...page, items: [follow, participation()] });
});

test("the dashboard query lists every kind this build can draw, then carries the cursor encoded", () => {
  const kinds = "?kinds=publication,vote,reading,follow,participation";
  assert.equal(dashboardQuery(), kinds);
  assert.equal(dashboardQuery("a b/c"), `${kinds}&cursor=a%20b%2Fc`);
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
