/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Tierlist } from "../tierlists/api.js";
import type { TournamentSummary } from "./api.js";
import { ARENA_TABS, coverRemainder, emptyCopy, filterItems, ownedItems, tabAtIndex, tabIndex, tierDistribution, tournamentProgress, type OwnedItem } from "./arenaHome.js";

const tierDetail = (items: OwnedItem[]): string | undefined => {
  const first = items[0];
  return first?.kind === "tierlist" ? first.detail : undefined;
};

const tournament = (over: Partial<TournamentSummary> = {}): TournamentSummary => ({
  id: "t1",
  name: "Best of 2025",
  bracketSize: 8,
  roundDurationMinutes: 60,
  status: "seeding",
  currentRound: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  ownerUserId: "u1",
  covers: [],
  filledSlots: 0,
  ...over,
});

const tierlist = (over: Partial<Tierlist> = {}): Tierlist => ({
  id: "l1",
  name: "Fantasy ranked",
  data: { tiers: [{ id: "s", label: "S", color: "#000000", bookKeys: [] }], pool: [] },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  voteCode: null,
  voteAccess: "anonymous",
  votingOpen: false,
  sourceTierlistId: null,
  ...over,
});

test("tab index round-trips through the pager's numeric page", () => {
  assert.deepEqual(ARENA_TABS.map((tab) => tab.value), ["tournaments", "tierlists"]);
  for (const tab of ARENA_TABS) assert.equal(tabAtIndex(tabIndex(tab.value)), tab.value);
  assert.equal(tabIndex("tierlists"), 1);
  // A pager can report a page outside the range mid-fling; clamping keeps the
  // indicator on a real tab instead of undefined.
  assert.equal(tabAtIndex(-1), "tournaments");
  assert.equal(tabAtIndex(9), "tierlists");
});

test("owned items summarise each kind for its card", () => {
  const [tourney] = ownedItems("tournaments", [tournament({ status: "active" })], []);
  assert.equal(tourney?.kind, "tournament");
  assert.equal(tourney?.name, "Best of 2025");

  assert.equal(tierDetail(ownedItems("tierlists", [], [tierlist()])), "0 books · 1 tier");
  assert.equal(tierDetail(ownedItems("tierlists", [], [tierlist({ voteCode: "abc", votingOpen: true })])), "0 books · 1 tier · voting open");

  const sorted = tierlist({ data: { tiers: [
    { id: "s", label: "S", color: "#c9482f", bookKeys: ["a", "b"] },
    { id: "a", label: "A", color: "#d98a3d", bookKeys: ["c"] },
  ], pool: [] } });
  assert.equal(tierDetail(ownedItems("tierlists", [], [sorted])), "3 books · 2 tiers");
});

test("search filters on name, case-insensitively, and ignores surrounding space", () => {
  const items = ownedItems("tournaments", [tournament({ id: "a", name: "Best of 2025" }), tournament({ id: "b", name: "Sci-fi cup" })], []);
  assert.deepEqual(filterItems(items, "  BEST ").map((item) => item.id), ["a"]);
  assert.deepEqual(filterItems(items, "   ").map((item) => item.id), ["a", "b"]);
});

test("empty copy distinguishes an empty tab from an unmatched search", () => {
  assert.equal(emptyCopy("tournaments", false).title, "No tournaments yet");
  assert.equal(emptyCopy("tierlists", false).title, "No tier lists yet");
  assert.equal(emptyCopy("tierlists", true).title, "Nothing matches");
  assert.equal(emptyCopy("tierlists", true).body, "Try a different search.");
});

test("tier distribution weights each segment by how many books sit in it", () => {
  const segments = tierDistribution([
    { id: "s", label: "S", color: "#c9482f", bookKeys: ["a", "b", "c"] },
    { id: "a", label: "A", color: "#d98a3d", bookKeys: ["d"] },
    { id: "b", label: "B", color: "#c9a53d", bookKeys: [] },
  ]);
  assert.deepEqual(segments, [
    { color: "#c9482f", weight: 3 },
    { color: "#d98a3d", weight: 1 },
    { color: "#c9a53d", weight: 0 },
  ]);
});

test("a tier list with nothing sorted yet draws an even ladder, not an empty bar", () => {
  const segments = tierDistribution([
    { id: "s", label: "S", color: "#c9482f", bookKeys: [] },
    { id: "a", label: "A", color: "#d98a3d", bookKeys: [] },
  ]);
  assert.deepEqual(segments.map((segment) => segment.weight), [1, 1]);
  assert.deepEqual(tierDistribution([]), []);
});

test("tournament progress reads differently at each stage", () => {
  assert.equal(tournamentProgress(tournament({ status: "seeding", bracketSize: 8, filledSlots: 3 })).label, "3 of 8 slots filled");
  assert.equal(tournamentProgress(tournament({ status: "completed", bracketSize: 8 })).label, "Winner decided");

  // 16 books is four rounds; round 2 is halfway.
  const active = tournamentProgress(tournament({ status: "active", bracketSize: 16, currentRound: 2 }));
  assert.equal(active.label, "Round 2 of 4");
  assert.equal(active.totalRounds, 4);
  assert.equal(active.completedRounds, 1);

  // The smallest bracket is a single duel.
  assert.equal(tournamentProgress(tournament({ status: "active", bracketSize: 2, currentRound: 1 })).label, "Round 1 of 1");
});

test("the cover remainder counts seeded books with no thumbnail shown", () => {
  assert.equal(coverRemainder(tournament({ filledSlots: 16, covers: ["a", "b", "c", "d"] })), 12);
  assert.equal(coverRemainder(tournament({ filledSlots: 3, covers: ["a", "b", "c"] })), 0);
  // A pool seeded entirely without art must not report a negative remainder.
  assert.equal(coverRemainder(tournament({ filledSlots: 0, covers: [] })), 0);
});
