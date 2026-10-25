import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { Page, PageWidthContext } from "../src/components/page/Page";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "../src/components/page/buttonClasses";
import { area, backTo } from "../src/lib/areas";

const render = (el: ReactElement, path = "/dashboard/arena?tab=quizzes", width?: number) =>
  renderToString(createElement(MemoryRouter, { initialEntries: [path] },
    width === undefined ? el : createElement(PageWidthContext.Provider, { value: width }, el)));

test("one display-font h1 in a surface band", () => {
  const html = render(createElement(Page, { title: "Games", children: "x" }));
  assert.equal(html.match(/<h1/g)?.length, 1);
  assert.match(html, /<h1 class="[^"]*font-display[^"]*text-2xl[^"]*sm:text-3xl/);
  assert.match(html, /bg-\(--color-surface\)[^"]*border-b border-\(--color-border\)|border-b border-\(--color-border\)[^"]*bg-\(--color-surface\)/);
});

test("the current tab is marked and every tab is a 44px target", () => {
  const html = render(createElement(Page, { title: "Games", tabs: area("games").tabs, children: "x" }));
  assert.match(html, /<a(?=[^>]*aria-current="page")[^>]*>Quizzes<\/a>/);
  assert.equal(html.match(/aria-current="page"/g)?.length, 1);
  assert.equal(html.match(/<a(?=[^>]*min-h-11)[^>]*>/g)?.length, 3);
});

test("back link names the area and is a 44px target", () => {
  const html = render(createElement(Page, { title: "Summer showdown", back: backTo("tournament"), children: "x" }));
  assert.match(html, /<a(?=[^>]*href="\/dashboard\/arena")(?=[^>]*min-h-11)[^>]*>[\s\S]*?Games<\/a>/);
});

test("a rename control can be the title", () => {
  const html = render(createElement(Page, { title: createElement("button", null, "Summer showdown"), children: "x" }));
  assert.match(html, /<h1[^>]*><button>Summer showdown<\/button><\/h1>/);
});

test("the body keeps PageContainer's padding", () => {
  assert.match(render(createElement(Page, { title: "T", children: "x" })), /px-4 py-5 sm:px-5 sm:py-8/);
});

test("a long title can wrap inside the band", () => {
  const html = render(createElement(Page, { title: "A".repeat(60), children: "x" }));
  assert.match(html, /min-w-0[^"]*break-words|break-words[^"]*min-w-0/);
});

test("body width comes from context, a prop overrides it", () => {
  assert.match(render(createElement(Page, { title: "T", children: "x" }), "/", 1400), /max-width:1400px/);
  assert.match(render(createElement(Page, { title: "T", maxWidth: 900, children: "x" }), "/", 1400), /max-width:900px/);
});

test("button classes meet the 44px floor", () => {
  for (const cls of [BUTTON_PRIMARY, BUTTON_SECONDARY]) assert.match(cls, /min-h-11/);
  assert.match(BUTTON_PRIMARY, /bg-\(--color-accent\)/);
});

test("Library area pages use Page with the Library tabs", () => {
  for (const file of ["LibraryPage", "GroupsPage", "GalleryPage"]) {
    const src = readFileSync(new URL(`../src/pages/${file}.tsx`, import.meta.url), "utf8");
    assert.match(src, /<Page[\s\S]*?tabs=\{area\("library"\)\.tabs\}/, file);
    assert.doesNotMatch(src, /<h2 className="[^"]*text-lg font-bold/, file);
  }
});
