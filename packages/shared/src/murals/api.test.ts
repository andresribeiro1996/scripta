import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { createMuralsApi, type MuralsApi } from "./api.js";

function recorder(answer: unknown = {}) {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return answer;
  }) as ApiRequest;
  return { calls, api: createMuralsApi(request) };
}

const cases: Array<[string, (api: MuralsApi) => Promise<unknown>, string, ApiRequestInit]> = [
  ["fetchMurals", (api) => api.fetchMurals(), "/murals", { auth: "required" }],
  ["fetchMural", (api) => api.fetchMural("m1"), "/murals/m1", { auth: "required" }],
  ["createMural", (api) => api.createMural("N", "paper" as never), "/murals", { method: "POST", body: { name: "N", theme: "paper", folderId: null }, auth: "required" }],
  ["updateMural", (api) => api.updateMural("m1", { name: "M", updatedAt: "u" }), "/murals/m1", { method: "PUT", body: { name: "M", updatedAt: "u" }, auth: "required" }],
  ["deleteMural", (api) => api.deleteMural("m1"), "/murals/m1", { method: "DELETE", auth: "required" }],
  ["setMuralCover", (api) => api.setMuralCover("m1", "i1", "https://x"), "/murals/m1/cover", { method: "PUT", body: { imageId: "i1", url: "https://x" }, auth: "required" }],
  ["clearMuralCover", (api) => api.clearMuralCover("m1"), "/murals/m1/cover", { method: "DELETE", auth: "required" }],
  ["shareMural", (api) => api.shareMural("m1"), "/murals/m1/share", { method: "POST", auth: "required" }],
  ["unshareMural", (api) => api.unshareMural("m1"), "/murals/m1/unshare", { method: "POST", auth: "required" }],
  ["fetchFolders", (api) => api.fetchFolders(), "/murals/folders", { auth: "required" }],
  ["createFolder", (api) => api.createFolder("F"), "/murals/folders", { method: "POST", body: { name: "F", parentId: null }, auth: "required" }],
  ["updateFolder", (api) => api.updateFolder("f1", { parentId: null }), "/murals/folders/f1", { method: "PUT", body: { parentId: null }, auth: "required" }],
  ["deleteFolder", (api) => api.deleteFolder("f1"), "/murals/folders/f1", { method: "DELETE", auth: "required" }],
];

for (const [name, call, path, init] of cases) {
  test(`${name} sends ${init.method ?? "GET"} ${path}`, async () => {
    const { calls, api } = recorder({ murals: [], folders: [] });
    await call(api);
    assert.deepEqual(calls, [{ path, init }]);
  });
}

test("lists are unwrapped and deletes resolve undefined", async () => {
  assert.deepEqual(await recorder({ murals: ["M"] }).api.fetchMurals(), ["M"]);
  assert.deepEqual(await recorder({ folders: ["F"] }).api.fetchFolders(), ["F"]);
  assert.equal(await recorder({}).api.deleteMural("m1"), undefined);
  assert.equal(await recorder({}).api.deleteFolder("f1"), undefined);
});
