/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { angleFor, sectorFor } from "./tierSort.js";

test("every target's own direction resolves back to it", () => {
  for (const count of [1, 2, 3, 5, 8]) {
    for (let index = 0; index < count; index += 1) {
      const angle = angleFor(index, count);
      assert.equal(sectorFor(Math.sin(angle) * 120, -Math.cos(angle) * 120, count), index, `${index} of ${count}`);
    }
  }
});

test("drags land in the nearest sector, wrapping past straight up", () => {
  assert.equal(sectorFor(0, -100, 4), 0);
  assert.equal(sectorFor(100, 0, 4), 1);
  assert.equal(sectorFor(0, 100, 4), 2);
  assert.equal(sectorFor(-100, 0, 4), 3);
  // Just short of a full turn counts as the first sector, not a fifth one.
  assert.equal(sectorFor(-1, -100, 4), 0);
});
