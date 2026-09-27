import assert from "node:assert/strict";
import { test } from "node:test";
import { gradeAnswers } from "./grade.js";
import type { QuizQuestion, SubmittedAnswer } from "./types.js";

const questions: QuizQuestion[] = [
  { id: "q0", type: "cover_title", bookKey: "b1", options: ["T1", "T2", "T3", "T4"], answerIndex: 2 },
  { id: "q1", type: "quote_title", bookKey: "b2", options: ["T1", "T2", "T3", "T4"], answerIndex: 0 }
];

test("a perfect run scores every question", () => {
  const submitted: SubmittedAnswer[] = [
    { questionId: "q0", choiceIndex: 2 },
    { questionId: "q1", choiceIndex: 0 }
  ];
  assert.deepEqual(gradeAnswers(questions, submitted), { score: 2, correct: { q0: true, q1: true } });
});

test("a miss scores only the correct answers", () => {
  const { score, correct } = gradeAnswers(questions, [
    { questionId: "q0", choiceIndex: 1 },
    { questionId: "q1", choiceIndex: 0 }
  ]);
  assert.equal(score, 1);
  assert.deepEqual(correct, { q0: false, q1: true });
});

test("answers to unknown questions are ignored; unanswered questions are false", () => {
  const { score, correct } = gradeAnswers(questions, [{ questionId: "nope", choiceIndex: 0 }]);
  assert.equal(score, 0);
  assert.deepEqual(correct, { q0: false, q1: false });
});
