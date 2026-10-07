import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { createGalleryApi } from "./api.js";

function recorder(answer: unknown = {}) {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return answer;
  }) as ApiRequest;
  return { calls, api: createGalleryApi(request) };
}

test("fetchGalleryImages unwraps images", async () => {
  const { calls, api } = recorder({ images: ["I"] });
  assert.deepEqual(await api.fetchGalleryImages(), ["I"]);
  assert.deepEqual(calls, [{ path: "/gallery", init: { auth: "required" } }]);
});

test("deleteGalleryImage encodes the id and resolves undefined", async () => {
  const { calls, api } = recorder({});
  assert.equal(await api.deleteGalleryImage("a/b"), undefined);
  assert.deepEqual(calls, [{ path: "/gallery/a%2Fb", init: { method: "DELETE", auth: "required" } }]);
});
