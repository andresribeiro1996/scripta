/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiClient } from "./apiClient.js";
import { createRequest } from "./request.js";

function fakeClient() {
  const calls: Array<{ path: string; init: unknown }> = [];
  const apiClient: ApiClient = {
    async request(path, init) {
      calls.push({ path, init });
      return { ok: true } as never;
    },
  };
  return { calls, apiClient };
}

test("required maps to auth true", async () => {
  const { calls, apiClient } = fakeClient();
  await createRequest(apiClient, () => null)("/a", { auth: "required" });
  assert.deepEqual(calls[0], { path: "/a", init: { auth: true } });
});

test("none maps to auth false even with a held token", async () => {
  const { calls, apiClient } = fakeClient();
  await createRequest(apiClient, () => "token")("/a", { auth: "none" });
  assert.deepEqual(calls[0], { path: "/a", init: { auth: false } });
});

test("optional with a held token maps to auth true", async () => {
  const { calls, apiClient } = fakeClient();
  await createRequest(apiClient, () => "token")("/a", { auth: "optional" });
  assert.deepEqual(calls[0], { path: "/a", init: { auth: true } });
});

test("optional without a token maps to auth false", async () => {
  const { calls, apiClient } = fakeClient();
  await createRequest(apiClient, () => null)("/a", { auth: "optional" });
  assert.deepEqual(calls[0], { path: "/a", init: { auth: false } });
});

test("method, body and signal pass through, and the answer is returned", async () => {
  const { calls, apiClient } = fakeClient();
  const signal = new AbortController().signal;
  const result = await createRequest(apiClient, () => null)("/a", { method: "PUT", body: { x: 1 }, auth: "required", signal });
  assert.deepEqual(calls[0], { path: "/a", init: { method: "PUT", body: { x: 1 }, signal, auth: true } });
  assert.deepEqual(result, { ok: true });
});
