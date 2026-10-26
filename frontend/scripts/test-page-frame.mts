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
  assert.match(html, /<h1 class="[^"]*font-display[^"]*font-bold[^"]*text-2xl[^"]*sm:text-3xl/);
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

test("the body keeps the page padding", () => {
  assert.match(render(createElement(Page, { title: "T", children: "x" })), /px-4 py-5 sm:px-5 sm:py-8/);
});

test("a page with its own heading can omit the title band and keep the body frame", () => {
  const html = render(createElement(Page, { title: null }, createElement("h1", null, "Quiz results")));
  assert.doesNotMatch(html, /<header/);
  assert.match(html, /px-4 py-5 sm:px-5 sm:py-8/);
  assert.match(html, /<h1>Quiz results<\/h1>/);
});

test("a long title can wrap inside the band", () => {
  const html = render(createElement(Page, { title: "A".repeat(60), children: "x" }));
  assert.match(html, /min-w-0[^"]*break-words|break-words[^"]*min-w-0/);
});

test("body width comes from context, a prop overrides only the body", () => {
  assert.match(render(createElement(Page, { title: "T", children: "x" }), "/", 1400), /max-width:1400px/);
  const html = render(createElement(Page, { title: "T", maxWidth: 900, children: "x" }), "/", 1400);
  assert.match(html, /<header[\s\S]*?max-width:1400px[\s\S]*?<\/header>/);
  assert.match(html, /<\/header><div[^>]*style="max-width:900px"/);
});

test("tabs and controls sit below the title band", () => {
  const html = render(createElement(Page, {
    title: "Library",
    subtitle: "84 books",
    actions: createElement("button", null, "Add a book"),
    tabs: area("library").tabs,
    children: "Library content"
  }));
  const header = html.slice(0, html.indexOf("</header>"));
  assert.doesNotMatch(header, /84 books|Add a book|aria-label="Sections"/);
  assert.match(html, /<\/header>[\s\S]*84 books[\s\S]*Add a book[\s\S]*aria-label="Sections"[\s\S]*Library content/);
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

test("Games, Community and Admin pages use Page with their area's tabs", () => {
  const pages: Array<[string, string]> = [
    ["ArenaListPage", "games"],
    ["DiscoverPage", "community"],
    ["PeoplePage", "community"],
    ["AdminGenresPage", "admin"],
    ["AdminSynopsesPage", "admin"],
    ["AdminTranslationsPage", "admin"]
  ];
  for (const [file, id] of pages) {
    const src = readFileSync(new URL(`../src/pages/${file}.tsx`, import.meta.url), "utf8");
    assert.match(src, new RegExp(`<Page[\\s\\S]*?tabs=\\{area\\("${id}"\\)\\.tabs\\}`), file);
  }
  const arena = readFileSync(new URL("../src/pages/ArenaListPage.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(arena, /aria-pressed/);
});

test("Settings tabs all use Page with the Settings tabs and no retired sections", () => {
  for (const file of ["SettingsPage", "SettingsAppearancePage", "LibraryStylePage"]) {
    const src = readFileSync(new URL(`../src/pages/${file}.tsx`, import.meta.url), "utf8");
    assert.match(src, /<Page[\s\S]*?tabs=\{area\("settings"\)\.tabs\}/, file);
  }
  const settings = readFileSync(new URL("../src/pages/SettingsPage.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(settings, />Appearance</);
  assert.doesNotMatch(settings, />Reader card</);
  assert.match(readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8"), /path="\/dashboard\/settings\/appearance"/);
});

test("Games and Murals single-item pages use Page with a back link built from backTo", () => {
  const pages: Array<[string, string]> = [
    ["TierListCreatePage", "tierlist"],
    ["TierListEditorPage", "tierlist"],
    ["QuizCreatePage", "quiz"],
    ["QuizEditorPage", "quiz"],
    ["ArenaSeedPage", "tournament"],
    ["MuralEditorPage", "mural"]
  ];
  for (const [file, kind] of pages) {
    const src = readFileSync(new URL(`../src/pages/${file}.tsx`, import.meta.url), "utf8");
    assert.match(src, /<Page[\s>]/, file);
    assert.match(src, /back=\{/, file);
    assert.match(src, new RegExp(`backTo\\("${kind}"\\)`), file);
    assert.doesNotMatch(src, /tabs=/, file);
    assert.doesNotMatch(src, /PageContainer/, file);
    assert.doesNotMatch(src, />[^<{]*\bArena\b[^<]*</, file);
    assert.doesNotMatch(src, /All tournaments|← Tier lists|← Quizzes/, file);
  }
});

test("Home, Murals, Reader card and profiles use Page", () => {
  const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
  for (const file of ["pages/HomePage", "pages/MuralsListPage", "pages/ReaderCardPage", "pages/CommunityProfilePage", "components/OwnShelfView"]) {
    const src = read(`${file}.tsx`);
    assert.match(src, /<Page[\s>]/, file);
    assert.doesNotMatch(src, /PageContainer/, file);
  }
  for (const file of ["pages/CommunityProfilePage", "components/OwnShelfView"]) {
    assert.match(read(`${file}.tsx`), /back=\{backTo\("profile"\)\}/, file);
  }
  assert.doesNotMatch(read("components/OwnShelfView.tsx"), /<h1/);
  assert.doesNotMatch(read("pages/MuralsListPage.tsx"), /uppercase/);
  assert.doesNotMatch(read("pages/HomePage.tsx"), /const button\b/);
});
