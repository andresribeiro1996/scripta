import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { createWorksApi } from "./api.js";

test("fetchWork is optional-auth and encodes the id", async () => {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return { id: "W" };
  }) as ApiRequest;
  assert.deepEqual(await createWorksApi(request).fetchWork("a/b"), { id: "W" });
  assert.deepEqual(calls, [{ path: "/works/a%2Fb", init: { auth: "optional" } }]);
});

test("fetchWorkStats is optional-auth and encodes the id", async () => {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return { community: null, tiers: null, tournaments: null };
  }) as ApiRequest;
  assert.deepEqual(await createWorksApi(request).fetchWorkStats("a/b"), { community: null, tiers: null, tournaments: null });
  assert.deepEqual(calls, [{ path: "/works/a%2Fb/stats", init: { auth: "optional" } }]);
});
