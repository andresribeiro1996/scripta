/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { assertSaved, attemptUpdate } from "./attemptUpdate.js";

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

test("the failure reaches the error callback so it can say why", async () => {
  const failure = new Error("Your library is over 10 MB, the most Scripta can store.");
  let received: unknown;
  assert.equal(
    await attemptUpdate(
      async () => { throw failure; },
      (error) => { received = error; },
    ),
    false,
  );
  assert.equal(received, failure);
});

test("assertSaved returns on success and throws the result's error on failure", () => {
  assertSaved({ ok: true } as never);
  const failure = new Error("nope");
  assert.throws(() => assertSaved({ ok: false, error: failure } as never), (error) => error === failure);
});
