import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { createArenaApi, type ArenaApi } from "./api.js";

function recorder(answer: unknown = {}) {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return answer;
  }) as ApiRequest;
  return { calls, api: createArenaApi(request) };
}

const book = { workId: "w1", title: "T", author: "A", cover: null };

const cases: Array<[string, (api: ArenaApi) => Promise<unknown>, string, ApiRequestInit]> = [
  ["createTournament", (api) => api.createTournament({ name: "N", bracketSize: 8, roundDurationMinutes: 60 }), "/arenas", { method: "POST", body: { name: "N", bracketSize: 8, roundDurationMinutes: 60 }, auth: "required" }],
  ["fetchMyTournaments", (api) => api.fetchMyTournaments(), "/arenas/mine", { auth: "required" }],
  ["fetchVotedTournaments", (api) => api.fetchVotedTournaments(), "/arenas/voted", { auth: "required" }],
  ["fetchTournament with a voter token", (api) => api.fetchTournament("t1", "tok en"), "/arenas/t1?voterToken=tok%20en", { auth: "optional" }],
  ["fetchTournament without a voter token", (api) => api.fetchTournament("t1"), "/arenas/t1", { auth: "optional" }],
  ["setTournamentSlots", (api) => api.setTournamentSlots("t1", [{ slotIndex: 0, book }]), "/arenas/t1/slots", { method: "PUT", body: { slots: [{ slotIndex: 0, book }] }, auth: "required" }],
  ["randomFillTournament", (api) => api.randomFillTournament("t1", [book]), "/arenas/t1/random-fill", { method: "POST", body: { pool: [book] }, auth: "required" }],
  ["startTournament", (api) => api.startTournament("t1"), "/arenas/t1/start", { method: "POST", auth: "required" }],
  ["voteOnDuel", (api) => api.voteOnDuel("t1", "d1", "tok", "w1"), "/arenas/t1/duels/d1/vote", { method: "POST", body: { voterToken: "tok", workId: "w1" }, auth: "optional" }],
  ["settleDuelEarly", (api) => api.settleDuelEarly("t1", "d1"), "/arenas/t1/duels/d1/settle", { method: "POST", auth: "required" }],
  ["resolveTiebreak", (api) => api.resolveTiebreak("t1", "d1", "w2"), "/arenas/t1/duels/d1/tiebreak", { method: "POST", body: { winnerWorkId: "w2" }, auth: "required" }],
  ["renameTournament", (api) => api.renameTournament("t1", "New"), "/arenas/t1", { method: "PATCH", body: { name: "New" }, auth: "required" }],
  ["deleteTournament", (api) => api.deleteTournament("t1"), "/arenas/t1", { method: "DELETE", auth: "required" }],
];

for (const [name, call, path, init] of cases) {
  test(`${name} sends ${init.method ?? "GET"} ${path}`, async () => {
    const { calls, api } = recorder();
    await call(api);
    assert.deepEqual(calls, [{ path, init }]);
  });
}

test("ids are encoded into one segment", async () => {
  const { calls, api } = recorder();
  await api.voteOnDuel("a/b", "c?d", "tok", "w1");
  assert.equal(calls[0]!.path, "/arenas/a%2Fb/duels/c%3Fd/vote");
});

test("envelopes are unwrapped", async () => {
  assert.equal(await recorder({ tournament: "T" }).api.createTournament({ name: "N", bracketSize: 8, roundDurationMinutes: 60 }), "T");
  assert.equal(await recorder({ tournaments: ["T"] }).api.fetchMyTournaments().then((list) => list[0]), "T");
  assert.equal(await recorder({ tournaments: ["T"] }).api.fetchVotedTournaments().then((list) => list[0]), "T");
  assert.equal(await recorder({ tournament: "V" }).api.fetchTournament("t1"), "V");
});

test("void endpoints resolve undefined", async () => {
  const { api } = recorder({});
  assert.equal(await api.startTournament("t1"), undefined);
  assert.equal(await api.deleteTournament("t1"), undefined);
  assert.equal(await api.voteOnDuel("t1", "d1", "tok", "w1"), undefined);
});
