/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Quiz } from "../quizzes/api.js";
import type { Tierlist, VotedTierlist } from "../tierlists/api.js";
import type { Tournament } from "./api.js";
import { ARENA_TABS, GAMES_TABS, NEW_GAMES, coverRemainder, emptyCopy, homeSections, nextOwnerFilter, ownedItems, previewCovers, tabAtIndex, tabIndex, tierDistribution, tournamentProgress, votedTierlistDetail, type OwnedItem, type SectionedItem } from "./arenaHome.js";

const itemDetail = (items: OwnedItem[]): string | undefined => {
  const first = items[0];
  return first?.kind === "tierlist" || first?.kind === "quiz" ? first.detail : undefined;
};

const tournament = (over: Partial<Tournament> = {}): Tournament => ({
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
  winner: null,
  ...over,
});

const tierlist = (over: Partial<Tierlist> = {}): Tierlist => ({
  id: "l1",
  name: "Fantasy ranked",
  data: { tiers: [{ id: "s", label: "S", color: "#000000", workIds: [] }], pool: [] },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  voteCode: null,
  voteAccess: "anonymous",
  votingOpen: false,
  sourceTierlistId: null,
  promotedAt: null,
  originCreatorId: "u1",
  ranksWorstFirst: false,
  ...over,
});

const quiz = (over: Partial<Quiz> = {}): Quiz => ({
  id: "q1",
  name: "Cover quiz",
  data: { sourceLabel: "", questionCount: 10, allowedTypes: [], books: [{ workId: "k", title: "T", author: "A", coverUrl: null, quote: null, blurb: null }], questions: null },
  voteCode: null,
  playOpen: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

test("tab index round-trips through the pager's numeric page", () => {
  assert.deepEqual(ARENA_TABS.map((tab) => tab.value), ["tournaments", "tierlists", "quizzes"]);
  for (const tab of ARENA_TABS) assert.equal(tabAtIndex(tabIndex(tab.value)), tab.value);
  assert.equal(tabIndex("tierlists"), 1);
  assert.equal(tabIndex("quizzes"), 2);
  // A pager can report a page outside the range mid-fling; clamping keeps the
  // indicator on a real tab instead of undefined.
  assert.equal(tabAtIndex(-1), "tournaments");
  assert.equal(tabAtIndex(9), "quizzes");
});

test("owned items summarise each kind for its card", () => {
  const [tourney] = ownedItems("tournaments", [tournament({ status: "active" })], []);
  assert.equal(tourney?.kind, "tournament");
  assert.equal(tourney?.name, "Best of 2025");

  assert.equal(itemDetail(ownedItems("tierlists", [], [tierlist()])), "0 books · 1 tier");
  assert.equal(itemDetail(ownedItems("tierlists", [], [tierlist({ voteCode: "abc", votingOpen: true })])), "0 books · 1 tier · voting open");

  const sorted = tierlist({ data: { tiers: [
    { id: "s", label: "S", color: "#c9482f", workIds: ["a", "b"] },
    { id: "a", label: "A", color: "#d98a3d", workIds: ["c"] },
  ], pool: [] } });
  assert.equal(itemDetail(ownedItems("tierlists", [], [sorted])), "3 books · 2 tiers");

  const partlySorted = tierlist({ data: { tiers: [{ id: "s", label: "S", color: "#c9482f", workIds: ["a"] }], pool: ["b", "c"] } });
  assert.equal(itemDetail(ownedItems("tierlists", [], [partlySorted])), "3 books · 1 tier");

  const published = tierlist({ voteCode: "abc", votingOpen: true, data: { tiers: [{ id: "s", label: "S", color: "#c9482f", workIds: [] }, { id: "a", label: "A", color: "#d98a3d", workIds: [] }], pool: ["a", "b", "c"] } });
  assert.equal(itemDetail(ownedItems("tierlists", [], [published])), "3 books · 2 tiers · voting open");
});

test("owned quiz items summarise book count and stage", () => {
  assert.equal(itemDetail(ownedItems("quizzes", [], [], [quiz()])), "1 book · draft");
  assert.equal(itemDetail(ownedItems("quizzes", [], [], [quiz({ voteCode: "abc", playOpen: true })])), "1 book · open");
  assert.equal(itemDetail(ownedItems("quizzes", [], [], [quiz({ voteCode: "abc", playOpen: false })])), "1 book · closed");
});

test("the quizzes tab has no voted section and its own empty copy", () => {
  assert.deepEqual(kinds(homeSections("quizzes", ownedItems("quizzes", [], [], [quiz()]), [], [])), ["header:Created by you · 1", "owned"]);
  assert.equal(emptyCopy("quizzes", false).title, "No quizzes yet");
});

test("empty copy distinguishes an empty tab from an unmatched search", () => {
  assert.equal(emptyCopy("tournaments", false).title, "No tournaments yet");
  assert.equal(emptyCopy("tierlists", false).title, "No tier lists yet");
  assert.equal(emptyCopy("tierlists", true).title, "Nothing matches");
  assert.equal(emptyCopy("tierlists", true).body, "Try a different search.");
});

test("tier distribution weights each segment by how many books sit in it", () => {
  const segments = tierDistribution([
    { id: "s", label: "S", color: "#c9482f", workIds: ["a", "b", "c"] },
    { id: "a", label: "A", color: "#d98a3d", workIds: ["d"] },
    { id: "b", label: "B", color: "#c9a53d", workIds: [] },
  ]);
  assert.deepEqual(segments, [
    { color: "#c9482f", weight: 3 },
    { color: "#d98a3d", weight: 1 },
    { color: "#c9a53d", weight: 0 },
  ]);
});

test("a tier list with nothing sorted yet draws an even ladder, not an empty bar", () => {
  const segments = tierDistribution([
    { id: "s", label: "S", color: "#c9482f", workIds: [] },
    { id: "a", label: "A", color: "#d98a3d", workIds: [] },
  ]);
  assert.deepEqual(segments.map((segment) => segment.weight), [1, 1]);
  assert.deepEqual(tierDistribution([]), []);
});

test("tournament progress reads differently at each stage", () => {
  assert.equal(tournamentProgress(tournament({ status: "seeding", bracketSize: 8, filledSlots: 3 })).label, "3 of 8 slots filled");
  // Completed says nothing: the card's status pill and winner cover do.
  assert.equal(tournamentProgress(tournament({ status: "completed", bracketSize: 8 })).label, "");

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

test("the champion is drawn once — as the card's cover, not in the stack too", () => {
  const champion = { workId: "b", title: "Hyperion", author: "Simmons", cover: "b" };
  const finished = tournament({ status: "completed", filledSlots: 4, covers: ["a", "b", "c"], winner: champion });
  assert.deepEqual(previewCovers(finished), ["a", "c"]);
  // Two in the stack, one as the winner cover, one seeded without art.
  assert.equal(coverRemainder(finished), 1);

  // A champion seeded without art still occupies the card's cover slot.
  const artless = tournament({ status: "completed", filledSlots: 3, covers: ["a", "b"], winner: { ...champion, cover: null } });
  assert.deepEqual(previewCovers(artless), ["a", "b"]);
  assert.equal(coverRemainder(artless), 0);
});

const votedTierlist = (over: Partial<VotedTierlist> = {}): VotedTierlist => ({
  id: "p1",
  ownerUserId: "u2",
  createdAt: "2026-01-01T00:00:00.000Z",
  voteCode: "abc12345",
  name: "Space ranked",
  poolSize: 6,
  ballotCount: 3,
  eligibleVoteCount: 2,
  promotedAt: null,
  votingOpen: true,
  covers: [],
  ...over,
});

const kinds = (sections: SectionedItem[]): string[] => sections.map((s) => ("title" in s ? `header:${s.title}` : s.kind));

test("Created by you always heads the owned rows, with a count, even with nothing voted on", () => {
  const owned = ownedItems("tournaments", [tournament({ id: "a" }), tournament({ id: "b" })], []);
  assert.deepEqual(kinds(homeSections("tournaments", owned, [], [])), ["header:Created by you · 2", "owned", "owned"]);
  assert.deepEqual(kinds(homeSections("tierlists", ownedItems("tierlists", [], [tierlist()]), [], [])), ["header:Created by you · 1", "owned"]);
});

test("a voted section gets its own counted heading after the owned one", () => {
  const sections = homeSections("tournaments", ownedItems("tournaments", [tournament()], []), [tournament({ id: "t2", name: "Public cup" })], []);
  assert.deepEqual(kinds(sections), ["header:Created by you · 1", "owned", "header:Voting in · 1", "votedTournament"]);

  const tierlistSections = homeSections("tierlists", ownedItems("tierlists", [], [tierlist()]), [], [votedTierlist(), votedTierlist({ id: "p2", voteCode: "zzz" })]);
  assert.deepEqual(kinds(tierlistSections), ["header:Created by you · 1", "owned", "header:Voted on · 2", "votedTierlist", "votedTierlist"]);

  const voted = tierlistSections[3];
  assert.ok(voted && voted.kind === "votedTierlist");
  assert.equal(voted.target, "/vote/abc12345");
});

test("a section with no rows has no heading", () => {
  assert.deepEqual(kinds(homeSections("tournaments", [], [tournament({ id: "t2" })], [])), ["header:Voting in · 1", "votedTournament"]);
  assert.deepEqual(homeSections("tournaments", [], [], []), []);
});

test("search narrows each section's rows and count, and drops a section it empties", () => {
  const owned = ownedItems("tournaments", [tournament({ id: "mine", name: "My cup" }), tournament({ id: "other", name: "Sci-fi" })], []);
  const voted = [tournament({ id: "theirs", name: "Public cup" })];
  const sections = homeSections("tournaments", owned, voted, [], "all", " CUP ");
  assert.deepEqual(sections.map((s) => s.key), ["created", "mine", "participating", "voted:theirs"]);
  assert.deepEqual(kinds(sections).filter((k) => k.startsWith("header")), ["header:Created by you · 1", "header:Voting in · 1"]);

  assert.deepEqual(kinds(homeSections("tournaments", owned, voted, [], "all", "sci")), ["header:Created by you · 1", "owned"]);
  assert.deepEqual(kinds(homeSections("tournaments", owned, voted, [], "all", "public")), ["header:Voting in · 1", "votedTournament"]);
  assert.deepEqual(homeSections("tournaments", owned, voted, [], "all", "nothing"), []);
  assert.deepEqual(homeSections("tournaments", owned, voted, []), homeSections("tournaments", owned, voted, [], "all", "   "));
});

test("the ownership filter keeps only created or only voted rows, still headed and counted", () => {
  const owned = ownedItems("tierlists", [], [tierlist({ id: "l1" }), tierlist({ id: "l2" })]);
  const voted = [votedTierlist()];
  assert.deepEqual(kinds(homeSections("tierlists", owned, [], voted, "mine")), ["header:Created by you · 2", "owned", "owned"]);
  assert.deepEqual(kinds(homeSections("tierlists", owned, [], voted, "voted")), ["header:Voted on · 1", "votedTierlist"]);
  assert.deepEqual(homeSections("tierlists", owned, [], [], "voted"), []);
  assert.deepEqual(kinds(homeSections("tierlists", owned, [], voted, "voted", "space")), ["header:Voted on · 1", "votedTierlist"]);
  assert.deepEqual(homeSections("tierlists", owned, [], voted, "voted", "fantasy"), []);
});

test("the ownership filter cycles All, Created by you, Voted on and back", () => {
  assert.equal(nextOwnerFilter("all"), "mine");
  assert.equal(nextOwnerFilter("mine"), "voted");
  assert.equal(nextOwnerFilter("voted"), "all");
});

test("an empty voted filter says so per tab, and search still reads as no match", () => {
  assert.equal(emptyCopy("tournaments", false, "voted").title, "You haven't voted in any tournaments yet");
  assert.equal(emptyCopy("tierlists", false, "voted").title, "You haven't voted in any tier lists yet");
  assert.equal(emptyCopy("tierlists", false, "mine").title, "No tier lists yet");
  assert.equal(emptyCopy("tierlists", true, "voted").title, "Nothing matches");
});

test("only an empty tab offers to create one", () => {
  assert.equal(emptyCopy("tournaments", false).action, "Create tournament");
  assert.equal(emptyCopy("tierlists", false, "mine").action, "Create tier list");
  assert.equal(emptyCopy("quizzes", false).action, "Create quiz");
  assert.equal(emptyCopy("tournaments", true).action, undefined);
  assert.equal(emptyCopy("tournaments", false, "voted").action, undefined);
});

test("voted tier list cards read like the public directory's", () => {
  assert.equal(votedTierlistDetail(votedTierlist()), "6 books · 3 ballots");
  assert.equal(votedTierlistDetail(votedTierlist({ votingOpen: false })), "6 books · 3 ballots · closed");
});

test("Games opens on Browse, with your three lists beside it, and New offers each kind", () => {
  assert.deepEqual(GAMES_TABS.map((tab) => tab.label), ["Browse", "Tournaments", "Tier lists", "Quizzes"]);
  assert.equal(GAMES_TABS[0].value, "browse");
  assert.deepEqual(NEW_GAMES.map((option) => [option.tab, option.label, option.href]), [
    ["tournaments", "Tournament", "/seed/new"],
    ["tierlists", "Tier list", "/tierlist/new"],
    ["quizzes", "Quiz", "/quiz/new"],
  ]);
});
