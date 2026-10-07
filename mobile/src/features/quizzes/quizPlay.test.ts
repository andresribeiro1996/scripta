/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicQuizQuestion } from "@scripta/shared";
import { buildSubmission, isComplete, nextIndex, playStage, playStorageKey } from "./quizPlay.js";

const question = (id: string): PublicQuizQuestion => ({ id, type: "cover_title", prompt: "https://covers.test/x.jpg", options: ["A", "B", "C", "D"] });
const questions = [question("q0"), question("q1"), question("q2")];

test("the storage key namespaces the play id per quiz code", () => {
  assert.equal(playStorageKey("abc123"), "quiz-play:abc123");
});

test("buildSubmission answers in question order and defaults gaps to option 0", () => {
  assert.deepEqual(buildSubmission(questions, { q1: 2 }), [
    { questionId: "q0", choiceIndex: 0 },
    { questionId: "q1", choiceIndex: 2 },
    { questionId: "q2", choiceIndex: 0 },
  ]);
});

test("isComplete requires an answer for every question", () => {
  assert.equal(isComplete(questions, { q0: 0, q1: 1, q2: 3 }), true);
  assert.equal(isComplete(questions, { q0: 0, q2: 3 }), false);
});

test("nextIndex advances but clamps to the last question", () => {
  assert.equal(nextIndex(questions, 0), 1);
  assert.equal(nextIndex(questions, 2), 2);
});

test("playStage walks loading → closed → playing → played", () => {
  const base = { boardReady: false, boardMissing: false, playOpen: true, resolved: false, alreadyPlayed: false };
  assert.equal(playStage(base), "loading");
  assert.equal(playStage({ ...base, boardReady: true, resolved: true }), "playing");
  assert.equal(playStage({ ...base, boardReady: true, resolved: true, alreadyPlayed: true }), "played");
  assert.equal(playStage({ ...base, boardReady: true, playOpen: false, resolved: true }), "closed");
  assert.equal(playStage({ ...base, boardReady: true, playOpen: false }), "loading");
  assert.equal(playStage({ ...base, boardReady: true, playOpen: false, resolved: true, alreadyPlayed: true }), "played");
  assert.equal(playStage({ ...base, boardMissing: true }), "unavailable");
});
