/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { QUIZ_QUESTION_TYPES } from "@scripta/shared";
import { quizCreateDirty } from "./quizCreateDraft.js";

const pristine = { name: "", source: "shelf", collectionId: "", poolIds: [], questionCount: 10, allowedTypes: [...QUIZ_QUESTION_TYPES] };

test("the untouched create form is not dirty", () => {
  assert.equal(quizCreateDirty(pristine), false);
  assert.equal(quizCreateDirty({ ...pristine, name: "   " }), false);
});

test("any typed name or changed choice makes the create form dirty", () => {
  assert.equal(quizCreateDirty({ ...pristine, name: "Mine" }), true);
  assert.equal(quizCreateDirty({ ...pristine, source: "pool" }), true);
  assert.equal(quizCreateDirty({ ...pristine, collectionId: "c1" }), true);
  assert.equal(quizCreateDirty({ ...pristine, poolIds: ["a"] }), true);
  assert.equal(quizCreateDirty({ ...pristine, questionCount: 5 }), true);
  assert.equal(quizCreateDirty({ ...pristine, allowedTypes: QUIZ_QUESTION_TYPES.slice(1) }), true);
});
