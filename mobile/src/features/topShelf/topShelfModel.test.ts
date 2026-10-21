import assert from "node:assert/strict";
import { test } from "node:test";
import type { TopShelf, TopShelfBook, TopShelfGame } from "@scripta/shared";
import { barFraction, boardTitle, gameScoreLabel, genreMenu, emptySections, valueLabel, visibleBoards } from "./topShelfModel.js";

const book = (value: number): TopShelfBook => ({ workId: "w", title: "Dune", author: "Herbert", coverUrl: null, value });
const data = (overrides: Partial<TopShelf> = {}): TopShelf => ({ period: "month", genre: null, genres: [], boards: {}, genreChampions: [], games: [], ...overrides });

test("valueLabel uses titles and tier bands", () => {
  assert.equal(valueLabel("crowned", 5), "5 titles");
  assert.equal(valueLabel("crowned", 1), "1 title");
  assert.equal(valueLabel("tiered", 12), "12 lists");
  assert.equal(valueLabel("highestTier", 0.05), "Top tier");
  assert.equal(valueLabel("highestTier", 0.95), "Bottom tier");
  assert.equal(valueLabel("quizzed", 7), "7 quizzes");
  assert.equal(valueLabel("risingStar", 4), "4 games");
  assert.equal(valueLabel("champions", 9), "9 pts");
});

test("visibleBoards hides rising star for all time", () => {
  assert.deepEqual(visibleBoards("month"), ["crowned", "tiered", "highestTier", "quizzed", "risingStar"]);
  assert.deepEqual(visibleBoards("all"), ["crowned", "tiered", "highestTier", "quizzed"]);
});

test("keeps the selected genre in the menu", () => {
  assert.deepEqual(genreMenu(["Fantasy", "Horror"], "Horror"), ["Fantasy", "Horror"]);
  assert.deepEqual(genreMenu(["Fantasy"], "Poetry"), ["Fantasy", "Poetry"]);
  assert.deepEqual(genreMenu(["Fantasy"], null), ["Fantasy"]);
});

test("emptySections", () => {
  assert.deepEqual(emptySections(data()), { podium: true, records: true, genres: true, games: true });
  const filled = data({
    boards: { champions: [book(9)], crowned: [book(1)] },
    genreChampions: [{ genre: "Fantasy", book: book(3) }],
    games: [{} as TopShelfGame],
  });
  assert.deepEqual(emptySections(filled), { podium: false, records: false, genres: false, games: false });
});

test("boardTitle names genre champions", () => {
  assert.equal(boardTitle("crowned", null), "Most crowned");
  assert.equal(boardTitle("tiered", null), "Most tiered");
  assert.equal(boardTitle("highestTier", null), "Highest tier");
  assert.equal(boardTitle("quizzed", null), "Most quizzed");
  assert.equal(boardTitle("risingStar", null), "Rising star");
  assert.equal(boardTitle("games", null), "Hottest games");
  assert.equal(boardTitle("champions", null), "Champions");
  assert.equal(boardTitle("champions", "Fantasy"), "Fantasy champions");
});

test("gameScoreLabel sums likes votes comments", () => {
  assert.equal(gameScoreLabel({ item: {} as TopShelfGame["item"], likes: 40, votes: 30, comments: 4 }), "74 interactions");
  assert.equal(gameScoreLabel({ item: {} as TopShelfGame["item"], likes: 1, votes: 0, comments: 0 }), "1 interaction");
});

test("barFraction is proportional to the leader and inverted for tier position", () => {
  assert.equal(barFraction("crowned", 5, 5), 1);
  assert.equal(barFraction("crowned", 1, 4), 0.25);
  assert.equal(barFraction("crowned", 0, 4), 0.04);
  assert.equal(barFraction("highestTier", 0.2, 0.2), 0.8);
});
