import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { dashboardQuery } from "../dashboard.js";
import { createCommunityApi, type CommunityApi } from "./api.js";
import type { DiscoverItem, FeedSettings, PublishProfileInput } from "./types.js";

function recorder(answer: unknown = {}) {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return answer;
  }) as ApiRequest;
  return { calls, api: createCommunityApi(request) };
}

const settings = {} as FeedSettings;
const input = {} as PublishProfileInput;

const cases: Array<[string, (api: CommunityApi) => Promise<unknown>, string, ApiRequestInit]> = [
  ["fetchDashboard", (api) => api.fetchDashboard(), "/community/dashboard" + dashboardQuery(), { auth: "required" }],
  ["markDashboardSeen", (api) => api.markDashboardSeen(), "/community/dashboard/seen", { method: "POST", auth: "required" }],
  ["fetchDiscover", (api) => api.fetchDiscover("tierlist" as never, "q", 20), "/community/discover?type=tierlist&q=q&offset=20", { auth: "optional" }],
  ["searchPeople", (api) => api.searchPeople("a b"), "/community/people?q=a%20b", { auth: "required" }],
  ["fetchSuggestedPeople", (api) => api.fetchSuggestedPeople(), "/community/people/suggested", { auth: "required" }],
  ["fetchProfile", (api) => api.fetchProfile("zoë"), "/community/profiles/zo%C3%AB", { auth: "optional" }],
  ["fetchActivity", (api) => api.fetchActivity("u", "c 1"), "/community/profiles/u/activity?cursor=c%201", { auth: "optional" }],
  ["fetchActivity without cursor", (api) => api.fetchActivity("u"), "/community/profiles/u/activity", { auth: "optional" }],
  ["fetchProfileLibrary", (api) => api.fetchProfileLibrary("u"), "/community/profiles/u/library", { auth: "none" }],
  ["updateFeedSettings", (api) => api.updateFeedSettings(settings), "/community/profile/feed-settings", { method: "PUT", body: settings, auth: "required" }],
  ["followUser", (api) => api.followUser("u1"), "/community/follows", { method: "POST", body: { userId: "u1" }, auth: "required" }],
  ["unfollowUser", (api) => api.unfollowUser("u/1"), "/community/follows/u%2F1", { method: "DELETE", auth: "required" }],
  ["publishProfile", (api) => api.publishProfile(input), "/community/profile/publish", { method: "PUT", body: input, auth: "required" }],
  ["unpublishProfile", (api) => api.unpublishProfile(), "/community/profile/publish", { method: "DELETE", auth: "required" }],
  ["fetchOwnProfile", (api) => api.fetchOwnProfile(), "/community/profile", { auth: "required" }],
  ["setShelfMural", (api) => api.setShelfMural("m1"), "/community/profile/mural", { method: "PUT", body: { muralId: "m1" }, auth: "required" }],
];

for (const [name, call, path, init] of cases) {
  test(`${name} sends ${init.method ?? "GET"} ${path}`, async () => {
    const { calls, api } = recorder({ items: [], people: [] });
    await call(api);
    assert.deepEqual(calls, [{ path, init }]);
  });
}

test("fetchDiscover drops items whose content kind this build cannot draw", async () => {
  const known = { author: {}, content: { kind: "quiz", id: "q1" } } as unknown as DiscoverItem;
  const unknown = { author: {}, content: { kind: "hologram", id: "h1" } } as unknown as DiscoverItem;
  const { api } = recorder({ items: [unknown, known], nextOffset: 20 });
  assert.deepEqual(await api.fetchDiscover("all", "", 0), { items: [known], nextOffset: 20 });
});

test("people lists are unwrapped", async () => {
  assert.deepEqual(await recorder({ people: ["P"] }).api.searchPeople("a"), ["P"]);
  assert.deepEqual(await recorder({ people: ["S"] }).api.fetchSuggestedPeople(), ["S"]);
});

test("void endpoints resolve undefined", async () => {
  const { api } = recorder({});
  assert.equal(await api.followUser("u1"), undefined);
  assert.equal(await api.markDashboardSeen(), undefined);
});
