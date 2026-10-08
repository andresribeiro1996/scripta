import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { createReaderCardApi } from "./api.js";

test("the reader card API reads and patches the owner's style", async () => {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const api = createReaderCardApi((async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return {};
  }) as ApiRequest);
  await api.fetchReaderCardStyle();
  await api.updateReaderCardStyle({ counter: "shelf" });
  assert.deepEqual(calls, [
    { path: "/library/reader-card/style", init: { auth: "required" } },
    { path: "/library/reader-card/style", init: { method: "PATCH", body: { counter: "shelf" }, auth: "required" } },
  ]);
});

test("the reader card API reads the owner's reader number", async () => {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const api = createReaderCardApi((async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return { readerNumber: 42 };
  }) as ApiRequest);
  assert.equal(await api.fetchReaderNumber(), 42);
  assert.deepEqual(calls, [{ path: "/library/reader-card/number", init: { auth: "required" } }]);
});
