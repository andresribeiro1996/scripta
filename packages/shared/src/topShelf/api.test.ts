import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { createTopShelfApi, recapMonthName } from "./api.js";
import type { TopShelf } from "./types.js";

function recorder(answer: unknown) {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return answer;
  }) as ApiRequest;
  return { calls, api: createTopShelfApi(request) };
}

const empty: TopShelf = { period: "month", genre: null, genres: [], boards: {}, genreChampions: [], games: [] };

test("fetchTopShelf builds the path and omits empty params", async () => {
  const { calls, api } = recorder(empty);
  await api.fetchTopShelf({ period: "month", genre: null });
  await api.fetchTopShelf({ period: "all", genre: "Science fiction", view: "crowned" });
  assert.deepEqual(calls, [
    { path: "/top-shelf?period=month", init: { auth: "none" } },
    { path: "/top-shelf?period=all&genre=Science+fiction&view=crowned", init: { auth: "none" } }
  ]);
});

test("fetchTopShelf drops unknown game kinds", async () => {
  const known = { item: { author: {}, content: { kind: "quiz" } }, likes: 1, votes: 2, comments: 3 };
  const unknown = { item: { author: {}, content: { kind: "mural" } }, likes: 0, votes: 0, comments: 0 };
  const { api } = recorder({ ...empty, games: [known, unknown] });
  assert.deepEqual((await api.fetchTopShelf({ period: "all", genre: null })).games, [known]);
});

test("fetchRecapIndex reads the index", async () => {
  const index = { months: ["2026-09"], currentMonth: "2026-10", announce: true };
  const { calls, api } = recorder(index);
  assert.deepEqual(await api.fetchRecapIndex(), index);
  assert.deepEqual(calls, [{ path: "/top-shelf/recaps", init: { auth: "none" } }]);
});

test("fetchRecap builds the path and drops unknown game kinds", async () => {
  const book = { workId: "w", title: "T", author: "A", coverUrl: null, value: 1 };
  const quiz = { author: {}, content: { kind: "quiz" } };
  const mural = { author: {}, content: { kind: "mural" } };
  const summary = { kind: "summary", gamesPublished: 1, votesCast: 2, booksInPlay: 3 };
  const cards = [
    summary,
    { kind: "book", board: "champions", book, game: quiz },
    { kind: "book", board: "crowned", book, game: mural },
    { kind: "hottestGame", game: { item: quiz, likes: 1, votes: 2, comments: 3 }, open: true },
    { kind: "hottestGame", game: { item: mural, likes: 1, votes: 2, comments: 3 }, open: false }
  ];
  const { calls, api } = recorder({ month: "2026-09", cards });
  const recap = await api.fetchRecap("2026-09");
  assert.deepEqual(calls, [{ path: "/top-shelf/recaps/2026-09", init: { auth: "none" } }]);
  await api.fetchRecap("a/b");
  assert.equal(calls[1]!.path, "/top-shelf/recaps/a%2Fb");
  assert.deepEqual(recap.cards, [
    cards[0],
    cards[1],
    { kind: "book", board: "crowned", book, game: null },
    cards[3]
  ]);
});

test("recapMonthName names the month", () => {
  assert.equal(recapMonthName("2026-10"), "October");
  assert.equal(recapMonthName("2027-01"), "January");
});
