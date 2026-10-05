import assert from "node:assert/strict";
import { test } from "node:test";
import { toSeedBook } from "./arenaSeed.js";

test("toSeedBook seeds a book's work and refuses a book without one", () => {
  assert.deepEqual(toSeedBook({ Title: "Dune", Attribution: "Frank Herbert", _workId: "w-dune" }, null), { workId: "w-dune", title: "Dune", author: "Frank Herbert", cover: null });
  assert.equal(toSeedBook({ Title: "Dune" }, null), null);
});
