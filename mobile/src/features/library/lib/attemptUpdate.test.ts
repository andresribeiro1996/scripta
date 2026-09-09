/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { attemptUpdate } from "./attemptUpdate.js";

test("failed updates are reported and never treated as successful", async () => {
  let errors = 0;
  let successes = 0;
  assert.equal(await attemptUpdate(async () => {}, () => { errors += 1; }, () => { successes += 1; }), true);
  assert.equal(
    await attemptUpdate(
      async () => { throw new Error("failed"); },
      () => { errors += 1; },
      () => { successes += 1; },
    ),
    false,
  );
  assert.equal(errors, 1);
  assert.equal(successes, 1);
});
