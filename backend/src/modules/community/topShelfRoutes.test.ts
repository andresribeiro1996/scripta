import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import type { TopShelf } from "@scripta/shared";
import { buildTopShelfRoutes } from "./topShelfRoutes.js";

const empty: TopShelf = { period: "month", genre: null, genres: [], boards: {}, genreChampions: [], games: [] };

const index = { months: ["2026-09"], currentMonth: "2026-10", announce: false };
const seenRecaps: unknown[] = [];
const recaps = { freezeMonth: () => undefined, freezeDue: () => undefined, getIndex: () => index, getRecap: (month: string, options?: { daily?: boolean }) => { seenRecaps.push(options); return month === "2026-09" ? { month, cards: [] } : null; } };

function appWith(seen: unknown[] = []) {
  const app = Fastify();
  void app.register(buildTopShelfRoutes({ getTopShelf: (query) => { seen.push(query); return empty; } }, recaps));
  return app;
}

test("GET /top-shelf?period=month returns 200 with no-store", async () => {
  const seen: unknown[] = [];
  const app = appWith(seen);
  const res = await app.inject({ url: "/top-shelf?period=month&genre=Fantasy&view=games" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.deepEqual(res.json(), empty);
  assert.deepEqual(seen, [{ period: "month", genre: "Fantasy", view: "games" }]);
  await app.close();
});

test("rejects a missing or unknown period or view with 400", async () => {
  const app = appWith();
  for (const url of ["/top-shelf", "/top-shelf?period=week", "/top-shelf?period=all&view=nope"]) {
    assert.equal((await app.inject({ url })).statusCode, 400, url);
  }
  await app.close();
});

test("rejects an over-long genre with 400", async () => {
  const app = appWith();
  assert.equal((await app.inject({ url: `/top-shelf?period=all&genre=${"x".repeat(81)}` })).statusCode, 400);
  assert.equal((await app.inject({ url: `/top-shelf?period=all&genre=${"x".repeat(80)}` })).statusCode, 200);
  await app.close();
});

test("GET /top-shelf/recaps returns the index", async () => {
  const app = appWith();
  const res = await app.inject({ url: "/top-shelf/recaps" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.deepEqual(res.json(), index);
  assert.deepEqual((await app.inject({ url: "/top-shelf/recaps/2026-09" })).json(), { month: "2026-09", cards: [] });
  await app.close();
});

test("rejects a malformed month with 400", async () => {
  const app = appWith();
  for (const month of ["2026-13", "2026-9", "abc", "2026-00"]) assert.equal((await app.inject({ url: `/top-shelf/recaps/${month}` })).statusCode, 400, month);
  await app.close();
});

test("returns 404 for a month without a recap", async () => {
  const app = appWith();
  assert.equal((await app.inject({ url: "/top-shelf/recaps/2026-10" })).statusCode, 404);
  await app.close();
});

test("400 and 404 responses are no-store too", async () => {
  const app = appWith();
  for (const url of ["/top-shelf", "/top-shelf/recaps/abc", "/top-shelf/recaps/2026-10"]) {
    assert.equal((await app.inject({ url })).headers["cache-control"], "no-store", url);
  }
  await app.close();
});

test("the Daily Chapter card is opt-in through ?daily=1 and nothing else", async () => {
  const app = appWith();
  seenRecaps.length = 0;
  assert.equal((await app.inject({ url: "/top-shelf/recaps/2026-09" })).statusCode, 200);
  assert.equal((await app.inject({ url: "/top-shelf/recaps/2026-09?daily=1" })).statusCode, 200);
  assert.deepEqual(seenRecaps, [{ daily: false }, { daily: true }]);
  assert.equal((await app.inject({ url: "/top-shelf/recaps/2026-09?daily=yes" })).statusCode, 400);
  await app.close();
});
