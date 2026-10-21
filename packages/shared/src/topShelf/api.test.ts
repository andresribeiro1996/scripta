import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { createTopShelfApi } from "./api.js";
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
