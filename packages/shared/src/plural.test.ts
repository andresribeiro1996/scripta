import assert from "node:assert/strict";
import { test } from "node:test";
import { plural } from "./plural.js";

test("plural uses the singular for exactly one and the plural otherwise", () => {
  assert.equal(plural(0, "play", "plays"), "0 plays");
  assert.equal(plural(1, "play", "plays"), "1 play");
  assert.equal(plural(2, "play", "plays"), "2 plays");
});
