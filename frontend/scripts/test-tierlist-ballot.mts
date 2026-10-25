import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "../src/api/client";
import { ballotOrNull } from "../src/api/tierlistVoting";
import { ballotQueryOptions } from "../src/hooks/useTierlistVoting";

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

async function ballotStatus(status: number) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "x" }), { status, headers: { "content-type": "application/json" } });
  try {
    const client = new QueryClient();
    return await client.fetchQuery(ballotQueryOptions("abc", "id1", true)).then(() => "ok", (error: unknown) => (error as Error).message);
  } finally {
    globalThis.fetch = original;
  }
}

test("the ballot query yields null on 404 and fails on 500 so the page can block submitting", async () => {
  assert.notEqual(await ballotStatus(500), "ok");
  const client = new QueryClient();
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "none" }), { status: 404, headers: { "content-type": "application/json" } });
  try {
    assert.equal(await client.fetchQuery(ballotQueryOptions("abc", "id1", true)), null);
  } finally {
    globalThis.fetch = original;
  }
});
