import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import type { TopShelf } from "@scripta/shared";
import { buildTopShelfRoutes } from "./topShelfRoutes.js";

const empty: TopShelf = { period: "month", genre: null, genres: [], boards: {}, genreChampions: [], games: [] };

function appWith(seen: unknown[] = []) {
  const app = Fastify();
  void app.register(buildTopShelfRoutes({ getTopShelf: (query) => { seen.push(query); return empty; } }));
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
