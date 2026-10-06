import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { WorkPage } from "@scripta/shared";
import { WorkPageView } from "../src/components/work/WorkPageView";

const page: WorkPage = {
  work: { id: "w", title: "Dune", author: "Frank Herbert", summary: null, coverUrl: null, editions: [{ bookId: "e1", title: "Dune", language: "en", year: 1965, isbn: "9780441013593", mine: true }] },
  mine: { bookKey: "isbn:9780441013593", readStatus: 2, rating: 4, highlightCount: 3 },
  readers: {
    followed: [{ username: "ana", avatarUrl: null, readStatus: 1, published: false }],
    others: [{ username: "bo", avatarUrl: null, readStatus: 2, published: true }],
    counts: { readers: 2, finished: 1 }
  },
  games: { tierlists: [{ id: "t1", name: "Best SF", owner: "app", path: "/vote/abc" }], arenas: [], quizzes: [] }
};

const render = (props: Parameters<typeof WorkPageView>[0]) => renderToString(createElement(MemoryRouter, null, createElement(WorkPageView, props)));

test("all four sections render in order, with no summary and no cover", () => {
  const html = render({ page, signedIn: true, backTo: "/", onBack: null, onAdd: () => undefined, onShare: () => undefined });
  const order = ["Dune", "Your copy", "Readers", "Games"].map((text) => html.indexOf(text));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(order.every((index) => index >= 0));
  assert.ok(html.includes("Loved it"));
  assert.ok(html.includes("2 readers · 1 finished"));
  assert.ok(html.includes("Scripta"));
  assert.ok(!html.includes("About this book"));
  assert.ok(html.includes("Back"));
});

test("Back links to the given fallback without history, and is a button with it", () => {
  const link = render({ page, signedIn: true, backTo: "/dashboard", onBack: null, onAdd: () => undefined, onShare: () => undefined });
  assert.ok(link.includes('href="/dashboard"'));
  const button = render({ page, signedIn: true, backTo: "/dashboard", onBack: () => undefined, onAdd: () => undefined, onShare: () => undefined });
  assert.ok(!button.includes('href="/dashboard"'));
  assert.ok(button.includes("Back"));
});

test("signed out: no copy shows the add action, and readers don't link to profiles", () => {
  const html = render({ page: { ...page, mine: null, readers: { ...page.readers, followed: [] } }, signedIn: false, backTo: "/", onBack: null, onAdd: () => undefined, onShare: () => undefined });
  assert.ok(html.includes("Not in your library"));
  assert.ok(html.includes("Add to library"));
  assert.ok(!html.includes("/community/u/bo"));
  assert.ok(html.includes("bo"));
  assert.ok(!html.includes("<h3"));
});

test("signed in: only published readers link to their profile", () => {
  const html = render({ page, signedIn: true, backTo: "/", onBack: null, onAdd: () => undefined, onShare: () => undefined });
  assert.ok(html.includes("/community/u/bo"));
  assert.ok(!html.includes("/community/u/ana"));
  assert.ok(html.includes("People you follow"));
  assert.ok(html.includes("Other readers"));
});

test("signed in with only one group: no sub-heading under Readers", () => {
  const html = render({ page: { ...page, readers: { ...page.readers, followed: [] } }, signedIn: true, backTo: "/", onBack: null, onAdd: () => undefined, onShare: () => undefined });
  assert.ok(!html.includes("Other readers"));
  assert.ok(!html.includes("<h3"));
});

test("an empty work page says so instead of rendering empty sections", () => {
  const html = render({ page: { ...page, readers: { followed: [], others: [], counts: { readers: 0, finished: 0 } }, games: { tierlists: [], arenas: [], quizzes: [] } }, signedIn: false, backTo: "/", onBack: null, onAdd: () => undefined, onShare: () => undefined });
  assert.ok(html.includes("No readers yet"));
  assert.ok(html.includes("No public games use this book yet."));
});

test("a long summary shows its preview and a Show more toggle; a short one shows whole", () => {
  const long = `${"Spice and sand. ".repeat(40)}The end.`;
  const html = render({ page: { ...page, work: { ...page.work, summary: long } }, signedIn: true, backTo: "/", onBack: null, onAdd: () => undefined, onShare: () => undefined });
  assert.ok(html.includes("About this book"));
  assert.ok(html.includes("Show more"));
  assert.ok(!html.includes("The end."));
  const short = render({ page: { ...page, work: { ...page.work, summary: "Spice." } }, signedIn: true, backTo: "/", onBack: null, onAdd: () => undefined, onShare: () => undefined });
  assert.ok(short.includes("Spice."));
  assert.ok(!short.includes("Show more"));
});
