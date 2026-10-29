import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { createDailyChapterApi } from "./dailyChapterApi.js";

function recorder() {
  const calls: ApiRequestInit[] = [];
  const request = (async (_path: string, init: ApiRequestInit) => { calls.push(init); return {}; }) as ApiRequest;
  return { calls, api: createDailyChapterApi(request) };
}

test("a member's history and play require auth, never going out anonymous", async () => {
  const { calls, api } = recorder();
  await api.history("guest", true);
  await api.play("e1", "guest", [], true);
  assert.deepEqual(calls.map((call) => call.auth), ["required", "required"]);
});

test("a guest's history and play send no credentials", async () => {
  const { calls, api } = recorder();
  await api.history("guest", false);
  await api.play("e1", "guest", [], false);
  assert.deepEqual(calls.map((call) => call.auth), ["none", "none"]);
});
