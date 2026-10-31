import assert from "node:assert/strict";
import { test } from "node:test";
import { roundMinutesFromHours, toSeedBook } from "./arenaSeed.js";

test("toSeedBook seeds a book's work and refuses a book without one", () => {
  assert.deepEqual(toSeedBook({ Title: "Dune", Attribution: "Frank Herbert", _workId: "w-dune" }, null, "en"), { workId: "w-dune", title: "Dune", author: "Frank Herbert", cover: null });
  assert.equal(toSeedBook({ Title: "Dune" }, null, "en"), null);
});

test("roundMinutesFromHours rounds to whole minutes and falls back to a day", () => {
  assert.equal(roundMinutesFromHours("24"), 1440);
  assert.equal(roundMinutesFromHours("4.1"), 246);
  assert.equal(roundMinutesFromHours("1.5"), 90);
  for (const text of ["", "  ", "abc", "0", "-3", "0.001"]) assert.equal(roundMinutesFromHours(text), 1440);
});
