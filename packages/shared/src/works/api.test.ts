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

test("fetchRecentAwards requests /awards/recent without auth", async () => {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const recent = { announcements: [] };
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return recent;
  }) as ApiRequest;
  assert.deepEqual(await createWorksApi(request).fetchRecentAwards(), recent);
  assert.deepEqual(calls, [{ path: "/awards/recent", init: { auth: "none" } }]);
});

test("fetchWorkCharacters posts the ids", async () => {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return { characters: {} };
  }) as ApiRequest;
  assert.deepEqual(await createWorksApi(request).fetchWorkCharacters(["a", "b"]), { characters: {} });
  assert.deepEqual(calls, [{ path: "/works/characters", init: { method: "POST", body: { workIds: ["a", "b"] }, auth: "optional" } }]);
});

test("fetchWorkCharacters splits more than 500 ids into two posts and merges them", async () => {
  const sizes: number[] = [];
  const request = (async (_path: string, init: ApiRequestInit) => {
    const ids = (init.body as { workIds: string[] }).workIds;
    sizes.push(ids.length);
    return { characters: { [ids[0]]: ["x"] } };
  }) as ApiRequest;
  const ids = Array.from({ length: 501 }, (_, i) => `w${i}`);
  assert.deepEqual(await createWorksApi(request).fetchWorkCharacters(ids), { characters: { w0: ["x"], w500: ["x"] } });
  assert.deepEqual(sizes, [500, 1]);
});
