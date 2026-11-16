/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { playStorageKey } from "./quizPlay.js";

test("the storage key namespaces the play id per quiz code", () => {
  assert.equal(playStorageKey("abc123"), "quiz-play:abc123");
});
