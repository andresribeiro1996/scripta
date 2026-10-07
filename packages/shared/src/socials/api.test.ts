import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { createSocialsApi, type SocialsApi } from "./api.js";

function recorder(answer: unknown = {}) {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return answer;
  }) as ApiRequest;
  return { calls, api: createSocialsApi(request) };
}

const cases: Array<[string, (api: SocialsApi) => Promise<unknown>, string, ApiRequestInit]> = [
  ["fetchSocials", (api) => api.fetchSocials(), "/socials", { auth: "required" }],
  ["createLinkSession", (api) => api.createLinkSession("x"), "/socials/x/link-session", { method: "POST", auth: "required" }],
  ["connectBluesky", (api) => api.connectBluesky("h", "p"), "/socials/bluesky/connect", { method: "POST", body: { handle: "h", appPassword: "p" }, auth: "required" }],
  ["disconnectSocial", (api) => api.disconnectSocial("threads"), "/socials/threads", { method: "DELETE", auth: "required" }],
  ["postToSocial", (api) => api.postToSocial("x", "hi"), "/socials/x/post", { method: "POST", body: { text: "hi" }, auth: "required" }],
];

for (const [name, call, path, init] of cases) {
  test(`${name} sends ${init.method ?? "GET"} ${path}`, async () => {
    const { calls, api } = recorder({ socials: [], linkId: "L" });
    await call(api);
    assert.deepEqual(calls, [{ path, init }]);
  });
}

test("envelopes are unwrapped", async () => {
  assert.deepEqual(await recorder({ socials: ["S"] }).api.fetchSocials(), ["S"]);
  assert.equal(await recorder({ linkId: "L" }).api.createLinkSession("x"), "L");
  assert.deepEqual(await recorder({ socials: ["S"] }).api.disconnectSocial("x"), ["S"]);
});
