/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { uploadWithTokenRecovery } from "./uploadWithTokenRecovery.js";

test("native uploads recover once from an expired access token", async () => {
  const tokens: string[] = [];
  const response = await uploadWithTokenRecovery(
    "access-old",
    async (token) => {
      tokens.push(token);
      return { status: tokens.length === 1 ? 401 : 200 };
    },
    async (rejectedToken) => {
      assert.equal(rejectedToken, "access-old");
      return "access-new";
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(tokens, ["access-old", "access-new"]);
});

test("native uploads stop after one retry", async () => {
  let attempts = 0;
  const response = await uploadWithTokenRecovery(
    "access-old",
    async () => {
      attempts += 1;
      return { status: 401 };
    },
    async () => "access-new",
  );

  assert.equal(response.status, 401);
  assert.equal(attempts, 2);
});
