import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { quizClueHeading, type QuizPreview } from "@scripta/shared";
import type { PublishedContent } from "@scripta/shared/community";
import { GameTicket } from "../src/components/games/GameTicket";

const render = (props: { kind: PublishedContent["kind"]; stats?: Array<{ value: number; label: string }>; preview?: QuizPreview }) =>
  renderToString(
    createElement(MemoryRouter, null, createElement(GameTicket, { name: "Night Reads", to: "/arena/x", meta: "meta", badges: null, covers: [], actionLabel: "Play quiz", ...props }))
  );

test("each kind tints its art panel with its own soft colour", () => {
  assert.match(render({ kind: "quiz" }), /border-r border-\(--color-border\) bg-\(--color-reference-soft\)/);
  assert.match(render({ kind: "tierlist" }), /border-r border-\(--color-border\) bg-\(--color-success-soft\)/);
  assert.match(render({ kind: "tournament" }), /border-r border-\(--color-border\) bg-\(--color-accent-soft\)/);
});

test("a quote_title preview shows its clue heading and prompt", () => {
  const html = render({ kind: "quiz", preview: { type: "quote_title", prompt: "Call me Ishmael." } });
  assert.ok(html.includes(quizClueHeading("quote_title")));
  assert.ok(html.includes("Call me Ishmael."));
});

test("a cover_title preview blurs the cover and shows no clue section", () => {
  const html = render({ kind: "quiz", preview: { type: "cover_title", prompt: "https://img.test/c.jpg" } });
  assert.match(html, /<img src="https:\/\/img\.test\/c\.jpg"[^>]*filter:blur\(6px\)/);
  assert.ok(!html.includes("<section"));
  assert.ok(!html.includes(quizClueHeading("cover_title")));
});

test("no stats means no stats divider", () => {
  assert.ok(!render({ kind: "tournament" }).includes("data-stats"));
  assert.ok(render({ kind: "tournament", stats: [{ value: 3, label: "votes" }] }).includes("data-stats"));
});

test("the footer link names the action and the game and points at the target", () => {
  assert.match(render({ kind: "quiz" }), /<a[^>]*aria-label="Play quiz: Night Reads"[^>]*href="\/arena\/x"/);
});

test("a quiz shows A/B/C chips", () => {
  const html = render({ kind: "quiz" });
  for (const letter of ["A", "B", "C"]) assert.ok(html.includes(`>${letter}</span>`));
});

test("the title link carries an sr-only kind prefix", () => {
  assert.match(render({ kind: "tierlist" }), /<span class="sr-only">Tier list: <\/span>Night Reads/);
});
