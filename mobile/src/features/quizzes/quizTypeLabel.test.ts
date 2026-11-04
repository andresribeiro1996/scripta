/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { QUIZ_QUESTION_TYPES } from "@scripta/shared";
import { setLocalePreference, t } from "../../i18n";
import { quizTypeLabel } from "./quizTypeLabel.js";

test("quiz question type labels are English by default", () => {
  assert.deepEqual(QUIZ_QUESTION_TYPES.map((type) => quizTypeLabel(type, "en")), ["Blurred cover → title", "Title → cover", "Quote → title", "Blurb → title", "Characters → title"]);
});

test("quiz question type labels follow the locale", () => {
  assert.equal(quizTypeLabel("quote_title", "pt-PT"), "Citação → título");
});

test("quiz messages follow the pick", () => {
  setLocalePreference("pt-PT");
  try {
    assert.equal(t("quizzes.questionOf", { number: 2, total: 5 }), "Pergunta 2 de 5");
    assert.equal(t("quizzes.rankOf", { rank: 3, total: 6 }), "3.º de 6 jogadores");
  } finally {
    setLocalePreference("auto");
  }
  assert.equal(t("quizzes.questionOf", { number: 2, total: 5 }), "Question 2 of 5");
});
