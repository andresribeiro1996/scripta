import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { PublicQuizQuestion } from "@scripta/shared";
import { QuizPrompt } from "../src/components/quiz/QuizPrompt";

const question = (type: PublicQuizQuestion["type"], prompt: string): PublicQuizQuestion => ({ id: "q", type, prompt, options: ["a", "b", "c", "d"] });
const render = (q: PublicQuizQuestion) => renderToString(createElement(QuizPrompt, { question: q }));

test("characters_title shows the caption and names, no quote marks", () => {
  const html = render(question("characters_title", "A · B · C"));
  assert.ok(html.includes("Who&#x27;s in this book?"));
  assert.ok(html.includes("A · B · C"));
  assert.ok(!html.includes("“"));
});

test("quote_title keeps its quote marks", () => {
  assert.match(render(question("quote_title", "Call me Ishmael.")).replaceAll("<!-- -->", ""), /“Call me Ishmael\.”/);
});
