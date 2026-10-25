import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../src/api/client";
import { ballotOrNull } from "../src/api/tierlistVoting";

test("a 404 means the caller has no ballot yet", async () => {
  assert.equal(await ballotOrNull(() => Promise.reject(new ApiError(404, "No tier list at that link."))), null);
});

test("other failures still propagate", async () => {
  await assert.rejects(ballotOrNull(() => Promise.reject(new ApiError(500, "boom"))), /boom/);
  await assert.rejects(ballotOrNull(() => Promise.reject(new TypeError("offline"))), /offline/);
});

test("a ballot passes through", async () => {
  const ballot = { ballotId: "b", placements: [] } as never;
  assert.equal(await ballotOrNull(() => Promise.resolve(ballot)), ballot);
});
