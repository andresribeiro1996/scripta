import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PlayResponse, PublicQuizQuestion } from "@scripta/shared";
import { QuizResults } from "../src/components/quiz/QuizResults";

const questions: PublicQuizQuestion[] = [
  { id: "cover", type: "title_cover", prompt: "Piranesi", options: ["/piranesi.jpg", "/circe.jpg"] },
  { id: "quote", type: "quote_title", prompt: "A quote", options: ["Circe", "Piranesi"] },
  { id: "repeat", type: "cover_title", prompt: "/piranesi.jpg", options: ["Piranesi", "Circe"] },
];
const result: PlayResponse = {
  playId: "play",
  score: 2,
  correct: { cover: false, quote: true, repeat: true },
  answers: { cover: { answerIndex: 0, choiceIndex: 1 }, quote: { answerIndex: 0, choiceIndex: 0 }, repeat: { answerIndex: 0, choiceIndex: 0 } },
};

function render(play: PlayResponse, plays: unknown[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["quizPublicResults", "challenge"], { plays, questionCount: 3 });
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "https://atmyshelf.com" } } });
  try {
    return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null,
      createElement(QuizResults, { code: "challenge", name: "Book quiz", questions, result: play }),
    )));
  } finally {
    client.clear();
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

test("results retain correct answers and show the player's wrong pick once", () => {
  const html = render(result);
  assert.match(html, /<header[\s\S]*<h1[^>]*>Book quiz<\/h1>[\s\S]*<\/header>/);
  assert.equal((html.match(/<h1 /g) ?? []).length, 1);
  assert.match(html, /<h1[^>]*>Book quiz<\/h1>/);
  assert.match(html, /aria-label="2 of 3 correct"/);
  assert.equal((html.match(/Your pick<\/p>/g) ?? []).length, 1);
  assert.equal((html.match(/Correct answer<\/p>/g) ?? []).length, 3);
  assert.match(html, /alt="Your picked cover"/);
  assert.doesNotMatch(html, /Your results|already played|Quiz complete| correct · /);
  assert.match(html, /value="https:\/\/atmyshelf.com\/play\/challenge"/);
  const artwork = html.slice(0, html.indexOf('</section>'));
  assert.equal((artwork.match(/<img /g) ?? []).length, 1);
});

test("mobile results connect the answer tabs and collapsed rows to their panels", () => {
  const html = render(result);
  assert.match(html, /role="tablist" aria-label="Quiz results"/);
  assert.match(html, /id="quiz-answers-tab" aria-selected="true" aria-controls="quiz-answers-panel"/);
  assert.match(html, /id="quiz-board-tab" aria-selected="false" aria-controls="quiz-board-panel"/);
  for (const question of questions) {
    assert.ok(html.includes(`aria-expanded="false" aria-controls="quiz-answer-${question.id}"`));
    assert.ok(html.includes(`id="quiz-answer-${question.id}"`));
  }
  assert.match(html, /Challenge a friend/);
});

test("legacy results keep every verdict without inventing answers or picks", () => {
  const { answers: _, ...legacy } = result;
  const html = render(legacy);
  assert.equal((html.match(/>Incorrect<\/p>/g) ?? []).length, 1);
  assert.equal((html.match(/>Correct<\/p>/g) ?? []).length, 2);
  assert.doesNotMatch(html, /Correct answer<\/p>|Your pick<\/p>/);
});

test("leaderboard preserves guest labels, scores, times and its empty state", () => {
  assert.match(render(result), /No plays yet/);
  const html = render(result, [{ playerName: "Martinha", anonymous: true, score: 3, durationMs: 16800 }]);
  assert.match(html, /Martinha/);
  assert.match(html, /Guest/);
  assert.match(html, /3\/3/);
  assert.match(html, /16\.8s/);
});
