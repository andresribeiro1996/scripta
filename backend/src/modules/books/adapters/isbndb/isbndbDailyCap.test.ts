import assert from "node:assert/strict";
import { test } from "node:test";
import { SourcePausedError } from "../../domain/errors.js";
import type { BookCatalog } from "../../domain/ports.js";
import { capDailyCalls } from "./isbndbDailyCap.js";

const lookup = { isbn: "9780441013593", title: "Dune", author: "Frank Herbert" };

test("the cap lets the limit through, refuses the next call until the next UTC day, then resets", async () => {
  let calls = 0;
  let clock = Date.parse("2026-10-01T23:00:00.000Z");
  const inner: BookCatalog = { fetchDetails: async () => { calls++; return null; }, search: async () => [] };
  const capped = capDailyCalls(inner, 1500, () => clock);
  for (let index = 0; index < 1500; index++) await capped.fetchDetails(lookup);
  assert.equal(calls, 1500);
  await assert.rejects(capped.fetchDetails(lookup), (error: unknown) => error instanceof SourcePausedError && error.retryAt === Date.parse("2026-10-02T00:00:00.000Z"));
  assert.equal(calls, 1500);
  clock = Date.parse("2026-10-02T00:00:00.000Z");
  await capped.fetchDetails(lookup);
  assert.equal(calls, 1501);
});

test("calls the inner catalog refuses to answer still count and its errors propagate", async () => {
  const inner: BookCatalog = { fetchDetails: async () => { throw new Error("boom"); }, search: async () => [] };
  const capped = capDailyCalls(inner, 1);
  await assert.rejects(capped.fetchDetails(lookup), /boom/);
  await assert.rejects(capped.fetchDetails(lookup), SourcePausedError);
});

test("searches pass through uncounted", async () => {
  let searches = 0;
  const inner: BookCatalog = { fetchDetails: async () => null, search: async () => { searches++; return []; } };
  const capped = capDailyCalls(inner, 0);
  await capped.search({ text: "dune" });
  assert.equal(searches, 1);
});
