import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiRequest, ApiRequestInit } from "../api/port.js";
import { createQuizzesApi, type QuizzesApi } from "./api.js";
import type { QuizDataInput } from "./types.js";

function recorder(answer: unknown = {}) {
  const calls: Array<{ path: string; init: ApiRequestInit }> = [];
  const request = (async (path: string, init: ApiRequestInit) => {
    calls.push({ path, init });
    return answer;
  }) as ApiRequest;
  return { calls, api: createQuizzesApi(request) };
}

const input = {} as QuizDataInput;
const submission = { answers: [{ questionId: "q1", choiceIndex: 0 }], durationMs: 1000 };

const cases: Array<[string, (api: QuizzesApi) => Promise<unknown>, string, ApiRequestInit]> = [
  ["fetchQuizzes", (api) => api.fetchQuizzes(), "/quizzes", { auth: "required" }],
  ["fetchQuiz", (api) => api.fetchQuiz("q1"), "/quizzes/q1", { auth: "required" }],
  ["createQuiz", (api) => api.createQuiz("N", input), "/quizzes", { method: "POST", body: { name: "N", data: input }, auth: "required" }],
  ["updateQuiz", (api) => api.updateQuiz("q1", { name: "M" }), "/quizzes/q1", { method: "PUT", body: { name: "M" }, auth: "required" }],
  ["deleteQuiz", (api) => api.deleteQuiz("q1"), "/quizzes/q1", { method: "DELETE", auth: "required" }],
  ["publishQuiz sends no body", (api) => api.publishQuiz("q1"), "/quizzes/q1/publish", { method: "POST", auth: "required" }],
  ["setPlayState", (api) => api.setPlayState("q1", true), "/quizzes/q1/voting", { method: "PUT", body: { open: true }, auth: "required" }],
  ["fetchQuizResults", (api) => api.fetchQuizResults("q1"), "/quizzes/q1/results", { auth: "required" }],
  ["fetchPlayBoard", (api) => api.fetchPlayBoard("c1"), "/quizzes/voting/c1", { auth: "none" }],
  ["submitPlay", (api) => api.submitPlay("c1", submission), "/quizzes/voting/c1/play", { method: "POST", body: submission, auth: "optional" }],
  ["fetchPlay own", (api) => api.fetchPlay("c1", null), "/quizzes/voting/c1/play", { auth: "optional" }],
  ["fetchPlay by id", (api) => api.fetchPlay("c1", "p1"), "/quizzes/voting/c1/play/p1", { auth: "optional" }],
  ["fetchPublicResults", (api) => api.fetchPublicResults("c1"), "/quizzes/voting/c1/results", { auth: "none" }],
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
  await api.fetchPlay("a b", "c/d");
  assert.equal(calls[0]!.path, "/quizzes/voting/a%20b/play/c%2Fd");
});

test("envelopes are unwrapped where the backend wraps", async () => {
  assert.equal(await recorder({ quizzes: ["Q"] }).api.fetchQuizzes().then((list) => list[0]), "Q");
  assert.equal(await recorder({ quiz: "Q" }).api.setPlayState("q1", false), "Q");
  assert.equal(await recorder({ board: "B" }).api.fetchPlayBoard("c1"), "B");
});

test("void endpoints resolve undefined", async () => {
  assert.equal(await recorder({}).api.deleteQuiz("q1"), undefined);
});
