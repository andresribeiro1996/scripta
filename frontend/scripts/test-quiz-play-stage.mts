import assert from "node:assert/strict";
import { test } from "node:test";
import { quizPlayStage } from "../src/lib/quizPlayStage.ts";

const base = { playOpen: true, hasResult: false, ownPlayPending: false };

test("an open quiz with no result is playable", () => {
  assert.equal(quizPlayStage(base), "playing");
  assert.equal(quizPlayStage({ ...base, ownPlayPending: true }), "playing");
});

test("a result always shows, open or closed", () => {
  assert.equal(quizPlayStage({ ...base, hasResult: true }), "result");
  assert.equal(quizPlayStage({ ...base, playOpen: false, hasResult: true }), "result");
});

test("a closed quiz waits for the own-play lookup, then shows the closed message", () => {
  assert.equal(quizPlayStage({ ...base, playOpen: false, ownPlayPending: true }), "loading");
  assert.equal(quizPlayStage({ ...base, playOpen: false }), "closed");
});
