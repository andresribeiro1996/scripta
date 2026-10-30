import assert from "node:assert/strict";
import { test } from "node:test";
import type { TopShelfBook, TopShelfGame, TopShelfRecapCard } from "@scripta/shared";
import type { DiscoverItem, PublishedContent } from "@scripta/shared/community";
import { recapCta, recapEntries, recapLinkPath, recapNumber, recapTitle } from "./recapModel.js";

const dune: TopShelfBook = { workId: "w 1", title: "Dune", author: "Herbert", coverUrl: null, value: 5 };
const tierlist = { kind: "tierlist", id: "t1", voteCode: "abc", name: "Sci-fi", covers: [] } as unknown as PublishedContent;
const quiz = { kind: "quiz", id: "q1", voteCode: "qz", name: "Quiz", covers: [] } as unknown as PublishedContent;
const tournament = { kind: "tournament", id: "b1", name: "Bracket", covers: [] } as unknown as PublishedContent;
const item = (content: PublishedContent) => ({ content }) as unknown as DiscoverItem;
const bookCard = (content: PublishedContent | null, board: "crowned" | "champions" = "crowned"): TopShelfRecapCard => ({ kind: "book", board, book: dune, game: content ? item(content) : null });
const hottest = (open: boolean): TopShelfRecapCard => ({ kind: "hottestGame", open, game: { item: item(tierlist), likes: 40, votes: 30, comments: 4 } as TopShelfGame });
const summary: TopShelfRecapCard = { kind: "summary", gamesPublished: 12, votesCast: 340, booksInPlay: 58 };

test("recapTitle names the month and the record", () => {
  assert.equal(recapTitle(summary, "2026-10"), "October on Atmyshelf");
  assert.equal(recapTitle(bookCard(null, "champions"), "2026-10"), "Book of the month");
  assert.equal(recapTitle(bookCard(null), "2026-10"), "👑 October's most crowned");
  assert.equal(recapTitle(hottest(true), "2026-10"), "🔥 October's hottest game");
});

test("recapNumber uses Top Shelf's words", () => {
  assert.equal(recapNumber(bookCard(null)), "5 titles");
  assert.equal(recapNumber(hottest(true)), "74 interactions");
  assert.equal(recapNumber(summary), "12 games published\n340 votes cast\n58 books in play");
});

test("recapCta frames a vote as counting for the current month", () => {
  assert.equal(recapCta(bookCard(tierlist), "2026-11"), "Rank it yourself — it counts for November");
  assert.equal(recapCta(bookCard(quiz), "2026-11"), "Play it yourself — it counts for November");
  assert.equal(recapCta(bookCard(tournament), "2026-11"), "Vote in the bracket — it counts for November");
  assert.equal(recapCta(bookCard(null), "2026-11"), "See Dune on Atmyshelf");
  assert.equal(recapCta(hottest(true), "2026-11"), "Play it yourself");
  assert.equal(recapCta(hottest(false), "2026-11"), "See how it ended");
  assert.equal(recapCta(summary, "2026-11"), "Join in on Atmyshelf");
});

test("recapLinkPath falls back to the book page and the landing page", () => {
  assert.equal(recapLinkPath(bookCard(tierlist)), "/vote/abc");
  assert.equal(recapLinkPath(bookCard(quiz)), "/play/qz");
  assert.equal(recapLinkPath(bookCard(tournament)), "/arena/b1");
  assert.equal(recapLinkPath(bookCard(null)), "/work/w%201");
  assert.equal(recapLinkPath(hottest(false)), "/vote/abc");
  assert.equal(recapLinkPath(summary), "/");
});

test("recapEntries plays the latest month when it is the last completed one", () => {
  assert.deepEqual(recapEntries({ months: ["2026-10", "2026-09"], currentMonth: "2026-11" }), { play: "2026-10", past: ["2026-09"] });
  assert.deepEqual(recapEntries({ months: ["2025-12"], currentMonth: "2026-01" }), { play: "2025-12", past: [] });
});

test("recapEntries hides the button when the last completed month has no recap", () => {
  assert.deepEqual(recapEntries({ months: ["2026-09", "2026-08"], currentMonth: "2026-11" }), { play: null, past: ["2026-09", "2026-08"] });
  assert.deepEqual(recapEntries({ months: [], currentMonth: "2026-11" }), { play: null, past: [] });
});

test("recapEntries keeps the button when the latest month is the current one", () => {
  assert.deepEqual(recapEntries({ months: ["2026-10", "2026-09"], currentMonth: "2026-10" }), { play: "2026-10", past: ["2026-09"] });
});

const daily: TopShelfRecapCard = { kind: "dailyChapter", players: 42, hardest: { title: "Poetry", date: "2026-11-04", average: 2.1 }, mostMissed: { title: "The Stranger", missedPercent: 71 }, topPlayers: [{ username: "marta", perfect: 9 }, { username: "joao", perfect: 7 }] };

test("the Daily Chapter recap card speaks for the whole community", () => {
  assert.equal(recapTitle(daily, "2026-11"), "📖 November's Daily Chapter");
  assert.equal(recapNumber(daily), "42 readers played\nHardest: Poetry · 2.1/5\nMost missed: The Stranger · 71%\nMost perfect: @marta (9), @joao (7)");
  assert.equal(recapNumber({ ...daily, hardest: null, mostMissed: null, topPlayers: [] }), "42 readers played");
  assert.equal(recapCta(daily, "2026-12"), "Play today's Daily Chapter");
  assert.equal(recapLinkPath(daily), "/daily");
});
