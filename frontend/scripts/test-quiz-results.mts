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
  answers: { cover: { answerIndex: 0, choiceIndex: 1, workId: "w1" }, quote: { answerIndex: 0, choiceIndex: 0, workId: "w2" }, repeat: { answerIndex: 0, choiceIndex: 0, workId: "w1" } },
};

const detailQuestions: PublicQuizQuestion[] = [
  { id: "d1", type: "cover_title", prompt: "/piranesi.jpg", options: ["Piranesi", "Circe"] },
  { id: "d2", type: "quote_title", prompt: "A long quote from a book", options: ["Circe", "Piranesi"] },
  { id: "d3", type: "blurb_title", prompt: "A blurb", options: ["Circe", "Piranesi"] },
];
const detail: PlayResponse = {
  playId: "play",
  score: 2,
  correct: { d1: true, d2: false, d3: true },
  answers: { d1: { answerIndex: 0, choiceIndex: 0, workId: "w1" }, d2: { answerIndex: 0, choiceIndex: 1, workId: "w2" }, d3: { answerIndex: 0, choiceIndex: 0, workId: null } },
};
const play = (extra: Record<string, unknown> = {}) => ({ playerName: "Martinha", anonymous: false, avatarUrl: null, isYou: false, score: 3, durationMs: 16800, ...extra });
const answerRows = (html: string) => html.slice(html.indexOf("<ol"), html.indexOf("</ol>")).split(/(?=<li )/).filter((row) => row.startsWith("<li"));
const boardRows = (html: string) => html.slice(html.lastIndexOf("<ol")).split(/(?=<li )/).filter((row) => row.startsWith("<li"));

function render(play: PlayResponse, plays: unknown[] = [], qs = questions) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["quizPublicResults", "challenge", "play"], { plays, questionCount: 3 });
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "https://atmyshelf.com" } } });
  try {
    return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null,
      createElement(QuizResults, { code: "challenge", name: "Book quiz", questions: qs, result: play }),
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

test("below lg the expanded body is only the cover comparison", () => {
  const panel = (html: string, id: string) => html.slice(html.indexOf(`id="quiz-answer-${id}"`));
  const comparison = (html: string, id: string) => panel(html, id).match(/<div class="([^"]*)"><div class="flex min-w-0/)![1]!;
  const html = render(result);
  assert.match(comparison(html, "quote"), /(?=.*\bhidden\b)(?=.*\blg:grid\b)/);
  assert.doesNotMatch(comparison(html, "quote"), /grid-cols-2/);
  assert.match(comparison(html, "cover"), /(?=.*\bgrid\b)(?=.*\bgrid-cols-2\b)/);
  assert.doesNotMatch(comparison(html, "cover"), /\bhidden\b/);
  const { answers: _, ...legacy } = result;
  const unavailable = panel(render(legacy), "cover").match(/<div class="([^"]*)"><p class="[^"]*">Answer details/);
  assert.ok(unavailable);
  assert.doesNotMatch(unavailable[1]!, /\bhidden\b/);
});

test("leaderboard preserves guest labels, scores, times and its empty state", () => {
  assert.match(render(result), /No plays yet/);
  const html = render(result, [play({ anonymous: true })]);
  assert.match(html, /Martinha/);
  assert.match(html, /Guest/);
  assert.match(html, /3\/3/);
  assert.match(html, /16\.8s/);
});

test("misses come first with their own prompt and cover", () => {
  const html = render(detail, [], detailQuestions);
  const [first, second] = answerRows(html);
  assert.match(first!, /“A long quote from a book”/);
  assert.doesNotMatch(first!, /piranesi\.jpg/);
  assert.match(second!, /src="[^"]*piranesi\.jpg/);
});

test("a wrong text answer names the pick on the collapsed row", () => {
  assert.match(render(detail, [], detailQuestions), /You picked Piranesi/);
});

test("a quote prompt is curly-quoted, and clamped while it can expand", () => {
  const [quote, , plain] = answerRows(render(detail, [], detailQuestions));
  assert.match(quote!, /line-clamp-2[^>]*>“A long quote from a book”</);
  assert.match(plain!, /<span class="[^"]*"[^>]*>“A blurb”</);
  assert.doesNotMatch(plain!.slice(0, plain!.indexOf("id=\"quiz-answer-")), /line-clamp-2/);
});

test("desktop shows the prompt in its open panel", () => {
  const [quote] = answerRows(render(detail, [], detailQuestions));
  const panel = quote!.slice(quote!.indexOf('id="quiz-answer-d2"'));
  assert.match(panel, /<p class="(?=[^"]*\bhidden\b)(?=[^"]*\blg:block\b)[^"]*">“A long quote from a book”<\/p>/);
  assert.doesNotMatch(panel.slice(0, panel.indexOf("</p>")), /line-clamp/);
});

test("a row with a work links to it, and one without does not", () => {
  const html = render(detail, [], detailQuestions);
  assert.match(html, /href="\/work\/w1"/);
  assert.match(html, /href="\/work\/w2"/);
  const [, , plain] = answerRows(html);
  assert.doesNotMatch(plain!, /href=/);
  assert.doesNotMatch(plain!, /aria-expanded/);
});

test("a legacy result keeps its verdicts without links or picks", () => {
  const { answers: _, ...legacy } = result;
  const html = render(legacy);
  assert.doesNotMatch(html, /href="\/work|You picked/);
});

test("the viewer's row is highlighted without visible text", () => {
  const html = render(result, [play({ isYou: true })]);
  assert.match(html, /<li[^>]*bg-\(--color-accent-soft\)/);
  assert.match(html, /Martinha <span class="sr-only">You</);
  assert.match(html, /<li[^>]*-mx-3[^>]*px-3/);
  assert.doesNotMatch(boardRows(render(result, [play()]))[0]!.match(/^<li[^>]*>/)![0], /-mx-3|px-3/);
  assert.doesNotMatch(render(result, [play()]), /<li[^>]*bg-\(--color-accent-soft\)|sr-only">You</);
});

test("first place's rank is in the accent colour", () => {
  const [first, second] = boardRows(render(result, [play(), play({ playerName: "Rui" })]));
  assert.match(first!, /<span class="[^"]*text-\(--color-accent\)[^"]*">1<\/span>/);
  assert.doesNotMatch(second!, /<span class="[^"]*text-\(--color-accent\)[^"]*">2<\/span>/);
});

test("a nameless guest reads Guest once", () => {
  const [row] = boardRows(render(result, [play({ playerName: null, anonymous: true })]));
  assert.equal((row!.match(/Guest/g) ?? []).length, 1);
});

test("rows carry avatars", () => {
  const [withAvatar, without] = boardRows(render(result, [play({ avatarUrl: "/a.jpg" }), play({ playerName: "Rui" })]));
  assert.match(withAvatar!, /src="\/a\.jpg"/);
  assert.doesNotMatch(without!, /<img/);
  assert.match(without!, />R<\/span>/);
});

test("the hero shows the rank, and the board gives a lone player the prompt", () => {
  const html = render(result, [play(), play({ isYou: true, playerName: "Me" })]);
  assert.match(html, /#2 of 2 players/);
  assert.doesNotMatch(html, /Just you so far/);
  const alone = render(result, [play({ isYou: true })]);
  assert.doesNotMatch(alone, /of 1 players/);
  assert.match(alone, /Just you so far\. Send the link to a friend\./);
  const results = alone.slice(0, alone.indexOf("</section>"));
  assert.doesNotMatch(results, /Just you so far/);
  const board = alone.slice(alone.indexOf('aria-labelledby="quiz-leaderboard-heading"'));
  assert.ok(board.indexOf("Just you so far") > board.indexOf("</li>"));
});

test("long times read as a clock", () => {
  assert.match(render(result, [play({ durationMs: 143200 })]), />2:23</);
});
