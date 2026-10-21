/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Quiz } from "../quizzes/api.js";
import type { Tierlist, VotedTierlist } from "../tierlists/api.js";
import type { Tournament } from "./api.js";
import { ARENA_TABS, GAMES_TABS, NEW_GAMES, emptyCopy, gameRow, homeSections, nextOwnerFilter, ownedItems, tierlistCovers, tabAtIndex, tabIndex, tournamentProgress, votedTierlistDetail, type OwnedItem, type SectionedItem } from "./arenaHome.js";

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
  assert.equal(itemDetail(ownedItems("tierlists", [], [tierlist({ voteCode: "abc", votingOpen: true })])), "0 books · 1 tier");

  const sorted = tierlist({ data: { tiers: [
    { id: "s", label: "S", color: "#c9482f", workIds: ["a", "b"] },
    { id: "a", label: "A", color: "#d98a3d", workIds: ["c"] },
  ], pool: [] } });
  assert.equal(itemDetail(ownedItems("tierlists", [], [sorted])), "3 books · 2 tiers");

  const partlySorted = tierlist({ data: { tiers: [{ id: "s", label: "S", color: "#c9482f", workIds: ["a"] }], pool: ["b", "c"] } });
  assert.equal(itemDetail(ownedItems("tierlists", [], [partlySorted])), "3 books · 1 tier");

  const published = tierlist({ voteCode: "abc", votingOpen: true, data: { tiers: [{ id: "s", label: "S", color: "#c9482f", workIds: [] }, { id: "a", label: "A", color: "#d98a3d", workIds: [] }], pool: ["a", "b", "c"] } });
  assert.equal(itemDetail(ownedItems("tierlists", [], [published])), "3 books · 2 tiers");
});

test("owned quiz items summarise book count", () => {
  assert.equal(itemDetail(ownedItems("quizzes", [], [], [quiz()])), "1 book");
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

test("tournament progress reads differently at each stage", () => {
  assert.equal(tournamentProgress(tournament({ status: "seeding", bracketSize: 8, filledSlots: 3 })).label, "3 of 8 slots filled");
  assert.equal(tournamentProgress(tournament({ status: "completed", bracketSize: 8 })).label, "");

  // 16 books is four rounds; round 2 is halfway.
  const active = tournamentProgress(tournament({ status: "active", bracketSize: 16, currentRound: 2 }));
  assert.equal(active.label, "Round 2 of 4");
  assert.equal(active.totalRounds, 4);
  assert.equal(active.completedRounds, 1);

  // The smallest bracket is a single duel.
  assert.equal(tournamentProgress(tournament({ status: "active", bracketSize: 2, currentRound: 1 })).label, "Round 1 of 1");
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
  assert.equal(votedTierlistDetail(votedTierlist({ votingOpen: false })), "6 books · 3 ballots");
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

test("an owned tournament row shows its bracket, status badge and progress", () => {
  const row = (over: Partial<Tournament>) => gameRow({ kind: "owned", key: "t1", item: ownedItems("tournaments", [tournament(over)], [])[0]! });
  const seeding = row({ filledSlots: 3, covers: ["a", "b"] });
  assert.deepEqual(seeding, { kind: "tournament", name: "Best of 2025", meta: "8-book bracket", badges: [{ label: "Seeding", tone: "neutral" }], caption: "3 of 8 slots filled", covers: ["a", "b"] });
  assert.deepEqual(row({ status: "active", currentRound: 2 }).badges, [{ label: "In progress", tone: "info" }]);
  assert.equal(row({ status: "active", currentRound: 2 }).caption, "Round 2 of 3");
  assert.deepEqual(row({ status: "completed" }).badges, [{ label: "Completed", tone: "success" }]);
  assert.equal(row({ status: "completed" }).caption, "");
});

test("an owned tier list row uses its own tier colours and has no covers to fan", () => {
  const row = (over: Partial<Tierlist>) => gameRow({ kind: "owned", key: "l1", item: ownedItems("tierlists", [], [tierlist(over)])[0]! });
  const draft = row({ data: { tiers: [{ id: "s", label: "S", color: "#c9482f", workIds: [] }, { id: "a", label: "A", color: "#d98a3d", workIds: [] }], pool: ["x"] } });
  assert.equal(draft.meta, "1 book · 2 tiers");
  assert.deepEqual(draft.badges, [{ label: "Draft", tone: "neutral" }]);
  assert.deepEqual(draft.ladder, ["#c9482f", "#d98a3d"]);
  assert.deepEqual(draft.covers, []);
  assert.deepEqual(row({ voteCode: "abc", votingOpen: true }).badges, [{ label: "Voting open", tone: "accent" }]);
  assert.deepEqual(row({ voteCode: "abc", votingOpen: false }).badges, [{ label: "Closed", tone: "neutral" }]);
});

test("tierlistCovers takes library books tier by tier, then the pool, skipping missing and repeated ones, capped at the fan", () => {
  const tier = (id: string, workIds: string[]) => ({ id, label: id, color: "#000", workIds });
  const byWork = new Map(["a", "b", "c", "d", "e"].map((id) => [id, { workId: id }]));
  const ids = (data: Tierlist["data"], books = byWork) => tierlistCovers(data, books).map((book) => book.workId);
  assert.deepEqual(ids({ tiers: [tier("s", ["a", "b"]), tier("a", ["c", "d"])], pool: ["e"] }), ["a", "b", "c"]);
  assert.deepEqual(ids({ tiers: [tier("s", ["a"]), tier("a", [])], pool: ["a", "b", "c", "d"] }), ["a", "b", "c"]);
  assert.deepEqual(ids({ tiers: [tier("s", ["x", "a", "y"])], pool: ["z", "b", "c", "d"] }), ["a", "b", "c"]);
  assert.deepEqual(ids({ tiers: [tier("s", ["a"])], pool: ["b"] }, new Map()), []);
  assert.deepEqual(ids({ tiers: [], pool: [] }), []);
});

test("an owned quiz row carries its books and an actual question preview", () => {
  const book = (coverUrl: string | null) => ({ workId: "k", title: "T", author: "A", coverUrl, quote: null, blurb: null });
  const row = (over: Partial<Quiz>) => gameRow({ kind: "owned", key: "q1", item: ownedItems("quizzes", [], [], [quiz(over)])[0]! });
  const draft = row({ data: { ...quiz().data, books: [book("a"), book(null), book("b")] } });
  assert.deepEqual(draft.covers, ["a", "b"]);
  assert.equal(draft.ladder, undefined);
  assert.equal(draft.meta, "3 books");
  assert.deepEqual(draft.badges, [{ label: "Draft", tone: "neutral" }]);
  assert.deepEqual(row({ voteCode: "abc", playOpen: true }).badges, [{ label: "Open", tone: "accent" }]);
  assert.deepEqual(row({ voteCode: "abc", playOpen: false }).badges, [{ label: "Closed", tone: "neutral" }]);
  assert.equal(draft.preview, undefined);
  const published = row({ data: { ...quiz().data, books: [{ ...book("a"), quote: "An actual quiz quote." }], questions: [{ id: "q0", workId: "k", type: "quote_title", options: ["T"], answerIndex: 0 }] } });
  assert.deepEqual(published.preview, { type: "quote_title", prompt: "An actual quiz quote." });
});

test("voted rows carry a Voted badge beside their status", () => {
  const voted = gameRow({ kind: "votedTournament", key: "voted:t1", target: "/arena/t1", tournament: tournament({ status: "active", currentRound: 1, covers: ["a"] }) });
  assert.deepEqual(voted.badges, [{ label: "In progress", tone: "info" }, { label: "Voted", tone: "info" }]);
  assert.deepEqual(voted.covers, ["a"]);

  const list = gameRow({ kind: "votedTierlist", key: "voted:p1", target: "/vote/abc12345", tierlist: votedTierlist({ covers: ["a", "b"], votingOpen: false }) });
  assert.equal(list.meta, "6 books · 3 ballots");
  assert.deepEqual(list.badges, [{ label: "Closed", tone: "neutral" }, { label: "Voted", tone: "info" }]);
  assert.deepEqual(list.covers, ["a", "b"]);
  assert.ok(list.ladder && list.ladder.length > 0);
});
