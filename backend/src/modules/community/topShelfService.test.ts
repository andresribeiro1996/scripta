import assert from "node:assert/strict";
import { test } from "node:test";
import type { TierlistShelfFacts } from "../tierlists/service.js";
import { createTopShelfService, type TopShelfDeps } from "./topShelfService.js";

const facts = (id: string, workIds: string[], votesSince = 3): TierlistShelfFacts => ({ id, ownerUserId: "u1", open: true, promoted: false, createdAt: "2026-10-05T00:00:00.000Z", voters: 5, votesSince, workIds, placements: [] });

function setup(clock = { at: Date.parse("2026-10-21T10:00:00Z") }) {
  const calls = { facts: [] as Array<string | null>, pages: [] as string[] };
  const tierlists = [facts("t1", ["w1", "w2", "w3", "w4"]), facts("t2", ["w1", "w2", "w3"]), facts("t3", ["w1", "w2"])];
  const shelf: TopShelfDeps = {
    tierlistFacts: (since) => { calls.facts.push(since); return tierlists; },
    tournamentFacts: () => [],
    quizFacts: () => [],
    canonicalWorks: (ids) => new Map(ids.map((id) => [id, id])),
    catalogGenres: () => new Map(),
    getWorkPage: (id) => {
      calls.pages.push(id);
      return { id, title: `Title ${id}`, author: `Author ${id}`, summary: null, aliasIds: [], editions: [{ coverUrl: null }, { coverUrl: `https://cdn.test/${id}.jpg` }] } as never;
    },
  };
  const ref = (id: string) => ({ id, ownerUserId: "u1", createdAt: "2026-10-05T00:00:00.000Z", voteCode: `c-${id}`, name: `List ${id}`, poolSize: 4, ballotCount: 5, eligibleVoteCount: 5, promotedAt: null, votingOpen: true, covers: [] });
  const community = {
    repo: { getProfileRow: () => undefined, getFeedSettings: () => undefined },
    tierlists: { getPublishedMany: (ids: string[]) => ids.map(ref), votedAmong: () => [] },
    tournaments: { getPublishedMany: () => [], votedAmong: () => [] },
    quizzes: { getPublishedMany: () => [], votedAmong: () => [] },
    resolveProfiles: (ids: string[]) => new Map(ids.map((id) => [id, { username: `user-${id}`, avatarUrl: null }])),
    readerGlyphFor: () => null,
  } as never;
  const engagementRepo = { gameEngagement: () => new Map() };
  const service = createTopShelfService({ engagementRepo, community, shelf, now: () => clock.at });
  return { service, calls, clock };
}

test("main view returns a podium of three and one leader per board", () => {
  const { service } = setup();
  const result = service.getTopShelf({ period: "all", genre: null });
  assert.deepEqual(result.boards.champions?.map((b) => b.workId), ["w1", "w2", "w3"]);
  assert.deepEqual(result.boards.tiered?.map((b) => b.workId), ["w1"]);
  assert.equal(result.games.length, 3);
  assert.equal(result.boards.champions?.[0]?.coverUrl, "https://cdn.test/w1.jpg");
  assert.equal(result.boards.champions?.[0]?.title, "Title w1");
});

test("a board view returns that board's top ten only", () => {
  const { service } = setup();
  const result = service.getTopShelf({ period: "all", genre: null, view: "tiered" });
  assert.deepEqual(Object.keys(result.boards), ["tiered"]);
  assert.deepEqual(result.boards.tiered?.map((b) => b.workId), ["w1", "w2", "w3", "w4"]);
  assert.deepEqual(result.games, []);
  const rising = service.getTopShelf({ period: "all", genre: null, view: "risingStar" });
  assert.deepEqual(rising.boards, { risingStar: [] });
});

test("games view returns games only", () => {
  const { service } = setup();
  const result = service.getTopShelf({ period: "all", genre: null, view: "games" });
  assert.deepEqual(result.boards, {});
  assert.deepEqual(result.games.map((g) => g.item.content.id), ["t1", "t2", "t3"]);
  assert.equal(result.games[0]?.votes, 3);
});

test("only returned works get a card", () => {
  const { service, calls } = setup();
  service.getTopShelf({ period: "all", genre: null });
  assert.deepEqual([...new Set(calls.pages)].sort(), ["w1", "w2", "w3"]);
});

test("reuses a cached result within 60 seconds", () => {
  const { service, calls, clock } = setup();
  const first = service.getTopShelf({ period: "month", genre: null });
  clock.at += 59_000;
  assert.deepEqual(service.getTopShelf({ period: "month", genre: null }), first);
  service.getTopShelf({ period: "month", genre: "Fantasy" });
  service.getTopShelf({ period: "month", genre: null, view: "games" });
  assert.equal(calls.facts.length, 1);
  assert.equal(calls.facts[0], "2026-09-30T23:00:00.000Z");
  clock.at += 2_000;
  service.getTopShelf({ period: "month", genre: null });
  assert.equal(calls.facts.length, 2);
});

test("does not reuse a cached month result after the Lisbon month rolls over", () => {
  const { service, calls, clock } = setup({ at: Date.parse("2026-10-31T23:59:30Z") });
  service.getTopShelf({ period: "month", genre: null });
  clock.at += 40_000;
  service.getTopShelf({ period: "month", genre: null });
  assert.equal(calls.facts.length, 2);
  assert.equal(calls.facts[1], "2026-11-01T00:00:00.000Z");
});

test("drops expired cache entries on write", () => {
  const { service, calls, clock } = setup();
  const start = clock.at;
  service.getTopShelf({ period: "all", genre: null });
  clock.at = start + 61_000;
  service.getTopShelf({ period: "month", genre: null });
  clock.at = start + 30_000;
  service.getTopShelf({ period: "all", genre: null });
  assert.equal(calls.facts.length, 3);
});
