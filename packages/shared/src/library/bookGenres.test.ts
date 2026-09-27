import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { GENRE_LOOKUP_BATCH, genreLookupOrder, settleWithConcurrency } from "./bookGenres.js";

test("genreLookupOrder puts finished books first, unread/reading after, both in stable order", () => {
  const unread = { Title: "A", ReadStatus: 0 };
  const finished1 = { Title: "B", ReadStatus: 2 };
  const reading = { Title: "C", ReadStatus: 1 };
  const finished2 = { Title: "D", ReadStatus: 2 };
  assert.deepEqual(genreLookupOrder([unread, finished1, reading, finished2]), [finished1, finished2, unread, reading]);
});

test("genreLookupOrder skips books that already have _genres, even an empty array", () => {
  const withGenres = { Title: "A", ReadStatus: 2, _genres: ["Fantasy"] };
  const withEmptyGenres = { Title: "B", ReadStatus: 2, _genres: [] };
  const needsLookup = { Title: "C", ReadStatus: 0 };
  assert.deepEqual(genreLookupOrder([withGenres, withEmptyGenres, needsLookup]), [needsLookup]);
});

test("GENRE_LOOKUP_BATCH is 20", () => {
  assert.equal(GENRE_LOOKUP_BATCH, 20);
});

test("settleWithConcurrency keeps results in input order regardless of finish order", async () => {
  const items = [30, 10, 20];
  const results = await settleWithConcurrency(items, 3, async (ms) => { await delay(ms); return ms; });
  assert.deepEqual(results, items.map((ms) => ({ status: "fulfilled", value: ms })));
});

test("settleWithConcurrency reports a rejection without stopping the others", async () => {
  const results = await settleWithConcurrency([1, 2, 3], 2, async (n) => {
    if (n === 2) throw new Error("boom");
    return n;
  });
  assert.equal(results[0]!.status, "fulfilled");
  assert.equal(results[1]!.status, "rejected");
  assert.equal(results[2]!.status, "fulfilled");
  assert.equal((results[1] as PromiseRejectedResult).reason.message, "boom");
});

test("settleWithConcurrency never runs more than limit at once", async () => {
  let active = 0;
  let peak = 0;
  await settleWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
    active++;
    peak = Math.max(peak, active);
    await delay(5);
    active--;
  });
  assert.equal(peak, 2);
});
