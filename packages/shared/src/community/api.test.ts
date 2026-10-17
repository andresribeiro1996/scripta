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
  ["fetchActivityEngagement", api => api.fetchActivityEngagement(["e1"]), "/community/activity/engagement", { method: "POST", body: { ids: ["e1"] }, auth: "required" }],
  ["likeActivity", api => api.likeActivity("a/b", true), "/community/activity/a%2Fb/like", { method: "PUT", body: { liked: true }, auth: "required" }],
  ["fetchActivityComments", api => api.fetchActivityComments("a/b", "c 1"), "/community/activity/a%2Fb/comments?cursor=c%201", { auth: "required" }],
  ["addActivityComment", api => api.addActivityComment("a/b", "Hello"), "/community/activity/a%2Fb/comments", { method: "POST", body: { text: "Hello" }, auth: "required" }],
  ["deleteActivityComment", api => api.deleteActivityComment("a/b"), "/community/activity/comments/a%2Fb", { method: "DELETE", auth: "required" }],
  ["fetchSavedState", api => api.fetchSavedState([{ kind: "quiz", id: "q" }]), "/community/saved/state", { method: "POST", body: { refs: [{ kind: "quiz", id: "q" }] }, auth: "required" }],
  ["saveContent", api => api.saveContent({ kind: "quiz", id: "q" }, true), "/community/saved", { method: "PUT", body: { ref: { kind: "quiz", id: "q" }, saved: true }, auth: "required" }],
  ["fetchSavedContent", api => api.fetchSavedContent("c 1"), "/community/saved?cursor=c%201", { auth: "required" }],
  ["fetchDashboard", (api) => api.fetchDashboard(), "/community/dashboard" + dashboardQuery(), { auth: "required" }],
  ["fetchDashboard with a cursor and kinds", (api) => api.fetchDashboard("c 1", ["follow"]), "/community/dashboard?kinds=follow&cursor=c%201", { auth: "required" }],
  ["markDashboardSeen", (api) => api.markDashboardSeen(), "/community/dashboard/seen", { method: "POST", auth: "required" }],
  ["fetchDiscover", (api) => api.fetchDiscover("tierlist" as never, "q", 20), "/community/discover?type=tierlist&q=q&offset=20", { auth: "optional" }],
  ["searchPeople", (api) => api.searchPeople("a b"), "/community/people?q=a%20b", { auth: "required" }],
  ["fetchSuggestedPeople", (api) => api.fetchSuggestedPeople(), "/community/people/suggested", { auth: "required" }],
  ["fetchSuggestedReaderPortraits", (api) => api.fetchSuggestedReaderPortraits(), "/community/people/suggested?previews=1", { auth: "required" }],
  ["fetchProfile", (api) => api.fetchProfile("zoë"), "/community/profiles/zo%C3%AB", { auth: "optional" }],
  ["fetchActivity", (api) => api.fetchActivity("u", "c 1"), "/community/profiles/u/activity?cursor=c%201", { auth: "optional" }],
  ["fetchActivity without cursor", (api) => api.fetchActivity("u"), "/community/profiles/u/activity", { auth: "optional" }],
  ["fetchProfileLibrary", (api) => api.fetchProfileLibrary("u"), "/community/profiles/u/library", { auth: "optional" }],
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
