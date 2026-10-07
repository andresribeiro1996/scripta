import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { createPublicApi } from "./api.js";

function recorder(answer: unknown = {}) {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return answer;
  }) as ApiRequest;
  return { calls, api: createPublicApi(request) };
}

test("fetchSharedMural is anonymous and encodes the token", async () => {
  const { calls, api } = recorder();
  await api.fetchSharedMural("a/b c");
  assert.deepEqual(calls, [{ path: "/murals/shared/a%2Fb%20c", init: { auth: "none" } }]);
});

test("fetchSharedLibrary is anonymous and encodes the token", async () => {
  const { calls, api } = recorder();
  await api.fetchSharedLibrary("t?1");
  assert.deepEqual(calls, [{ path: "/library/shared/t%3F1", init: { auth: "none" } }]);
});
