import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { createTierlistsApi, type TierlistsApi } from "./api.js";

function recorder(answer: unknown = {}) {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return answer;
  }) as ApiRequest;
  return { calls, api: createTierlistsApi(request) };
}

const data = { tiers: [], pool: ["w1"] };
const placements = [{ workId: "w1", tierId: "s" }];

const cases: Array<[string, (api: TierlistsApi) => Promise<unknown>, string, ApiRequestInit]> = [
  ["fetchTierlists", (api) => api.fetchTierlists(), "/tierlists", { auth: "required" }],
  ["fetchTierlist", (api) => api.fetchTierlist("t1"), "/tierlists/t1", { auth: "required" }],
  ["createTierlist", (api) => api.createTierlist("N", data, "members"), "/tierlists", { method: "POST", body: { name: "N", data, access: "members" }, auth: "required" }],
  ["updateTierlist", (api) => api.updateTierlist("t1", { name: "M" }), "/tierlists/t1", { method: "PUT", body: { name: "M" }, auth: "required" }],
  ["deleteTierlist", (api) => api.deleteTierlist("t1"), "/tierlists/t1", { method: "DELETE", auth: "required" }],
  ["fetchVotedTierlists", (api) => api.fetchVotedTierlists(), "/tierlists/voted", { auth: "required" }],
  ["fetchVotingBoard", (api) => api.fetchVotingBoard("c1"), "/tierlists/voting/c1", { auth: "none" }],
  ["submitBallot new", (api) => api.submitBallot("c1", placements, null), "/tierlists/voting/c1/ballot", { method: "POST", body: { placements }, auth: "optional" }],
  ["submitBallot edit", (api) => api.submitBallot("c1", placements, "b1"), "/tierlists/voting/c1/ballot/b1", { method: "PUT", body: { placements }, auth: "optional" }],
  ["fetchBallot", (api) => api.fetchBallot("c1", "b1"), "/tierlists/voting/c1/ballot/b1", { auth: "optional" }],
  ["fetchMyBallot", (api) => api.fetchMyBallot("c1"), "/tierlists/voting/c1/ballot", { auth: "optional" }],
  ["fetchTierlistResults", (api) => api.fetchTierlistResults("t1"), "/tierlists/t1/results", { auth: "required" }],
  ["openVoting", (api) => api.openVoting("t1", "anonymous"), "/tierlists/t1/open-voting", { method: "POST", body: { access: "anonymous" }, auth: "required" }],
  ["setVotingState", (api) => api.setVotingState("t1", { open: false }), "/tierlists/t1/voting", { method: "PUT", body: { open: false }, auth: "required" }],
];

for (const [name, call, path, init] of cases) {
  test(`${name} sends ${init.method ?? "GET"} ${path}`, async () => {
    const { calls, api } = recorder();
    await call(api);
    assert.deepEqual(calls, [{ path, init }]);
  });
}

test("codes and ids are encoded into one segment", async () => {
  const { calls, api } = recorder();
  await api.fetchBallot("a/b", "c#d");
  assert.equal(calls[0]!.path, "/tierlists/voting/a%2Fb/ballot/c%23d");
});

test("envelopes are unwrapped where the backend wraps", async () => {
  assert.equal(await recorder({ tierlists: ["L"] }).api.fetchTierlists().then((list) => list[0]), "L");
  assert.equal(await recorder({ tierlists: ["V"] }).api.fetchVotedTierlists().then((list) => list[0]), "V");
  assert.equal(await recorder({ tierlist: "T" }).api.setVotingState("t1", {}), "T");
  assert.deepEqual(await recorder({ board: "B", books: [] }).api.fetchVotingBoard("c1"), { board: "B", books: [] });
});

test("void endpoints resolve undefined", async () => {
  assert.equal(await recorder({}).api.deleteTierlist("t1"), undefined);
});
