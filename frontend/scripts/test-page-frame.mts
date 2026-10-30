import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { Page } from "../src/components/page/Page";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "../src/components/page/buttonClasses";
import { area, backTo } from "../src/lib/areas";

const render = (el: ReactElement, path = "/dashboard/arena?tab=quizzes") =>
  renderToString(createElement(MemoryRouter, { initialEntries: [path] }, el));

test("no band: one display h1 at 30px, 40px from lg, wrapping", () => {
  const html = render(createElement(Page, { title: "A".repeat(120), children: "x" }));
  assert.equal(html.match(/<h1/g)?.length, 1);
  assert.match(html, /<h1 class="[^"]*font-display[^"]*break-words[^"]*text-3xl[^"]*font-bold[^"]*lg:text-\[2\.5rem\][^"]*lg:leading-\[3rem\]/);
  assert.match(html, /<div class="min-w-0"><h1 class="/);
  assert.doesNotMatch(html.slice(0, html.indexOf("</header>")), /bg-\(--color-surface\)/);
});

test("back link above the title, actions on the title row, subtitle under the title, tabs last", () => {
  const html = render(createElement(Page, { title: "Library", back: backTo("tournament"), subtitle: "84 books", actions: createElement("button", null, "Add a book"), tabs: area("library").tabs, children: "BODY" }), "/dashboard/library");
  const header = html.slice(0, html.indexOf("</header>"));
  assert.match(header, /<a(?=[^>]*href="\/dashboard\/arena")(?=[^>]*min-h-11)[^>]*>[\s\S]*?Games<\/a>[\s\S]*<h1[\s\S]*84 books[\s\S]*Add a book[\s\S]*aria-label="Sections"/);
  assert.match(header, /<div class="flex flex-wrap items-end justify-between[^"]*"><div class="min-w-0"><h1 class="[^"]*">Library<\/h1><div class="mt-1\.5[^"]*">84 books<\/div><\/div><div class="flex flex-wrap items-center gap-2"><button>Add a book<\/button><\/div><\/div>/);
  assert.match(html, /<\/header>[\s\S]*BODY/);
});

test("tabs: 44px, one current, underline on the hairline", () => {
  const html = render(createElement(Page, { title: "Games", tabs: area("games").tabs, children: "x" }));
  assert.equal(html.match(/<a(?=[^>]*min-h-11)(?=[^>]*min-w-11)(?=[^>]*justify-center)(?=[^>]*border-b-2)[^>]*>/g)?.length, 3);
  assert.equal(html.match(/<a(?=[^>]*border-b-2)(?=[^>]*focus-visible:-outline-offset-2!)[^>]*>/g)?.length, 3);
  assert.match(html, /<nav(?=[^>]*aria-label="Sections")(?=[^>]*overflow-x-auto)(?=[^>]*shadow-\[inset_0_-1px_0_var\(--color-border\)\])[^>]*>/);
  assert.doesNotMatch(html, /-mb-px/);
  assert.doesNotMatch(html, /<nav[^>]*(?:border-b|pb-px)/);
  assert.match(html, /<\/header><div class="pt-6">/);
  assert.match(html, /<a(?=[^>]*aria-current="page")[^>]*>Quizzes<\/a>/);
  assert.equal(html.match(/aria-current="page"/g)?.length, 1);
});

test("a rename control can be the title", () => {
  const html = render(createElement(Page, { title: createElement("button", null, "Summer showdown"), children: "x" }));
  assert.match(html, /<h1[^>]*><button>Summer showdown<\/button><\/h1>/);
});

test("widths: default 1200, wide 1440, narrow 760, maxWidth wins (owner's 800 and 1800)", () => {
  assert.match(render(createElement(Page, { title: "T", children: "x" })), /max-width:1200px/);
  assert.match(render(createElement(Page, { title: "T", width: "wide", children: "x" })), /max-width:1440px/);
  assert.match(render(createElement(Page, { title: "T", width: "narrow", children: "x" })), /max-width:760px/);
  for (const w of [800, 1800]) assert.match(render(createElement(Page, { title: "T", width: "wide", maxWidth: w, children: "x" })), new RegExp(`max-width:${w}px`));
  assert.match(render(createElement(Page, { title: "T", children: "x" })), /px-4 [^"]*sm:px-6 [^"]*lg:px-8/);
});

test("header and body share one container, gutters outside the width", () => {
  const html = render(createElement(Page, { title: "T", width: "wide", children: "BODY" }));
  assert.equal(html.match(/max-width:/g)?.length, 1);
  assert.match(html, /<div class="[^"]*px-4 [^"]*sm:px-6 [^"]*lg:px-8[^"]*"><div class="mx-auto[^"]*" style="max-width:1440px">[\s\S]*<header[\s\S]*BODY/);
  assert.match(html, /<\/header><div class="pt-8">BODY<\/div>/);
});

test("title null drops the title row but keeps a back link and the container", () => {
  const html = render(createElement(Page, { title: null, back: backTo("profile") }, createElement("h1", null, "Ana")));
  assert.match(html, /<a(?=[^>]*min-h-11)[^>]*>[\s\S]*?Community<\/a>/);
  assert.equal(html.match(/<h1/g)?.length, 1);
  assert.match(html, /max-width:1200px/);
  const bare = render(createElement(Page, { title: null }, createElement("h1", null, "Quiz results")));
  assert.doesNotMatch(bare, /<header/);
  assert.match(bare, /<div class="pt-8"><h1>Quiz results<\/h1>/);
});

test("button classes meet the 44px floor", () => {
  for (const cls of [BUTTON_PRIMARY, BUTTON_SECONDARY]) assert.match(cls, /min-h-11/);
  assert.match(BUTTON_PRIMARY, /bg-\(--color-accent\)/);
});

test("every Page in these files declares the width, loading states included", () => {
  const read = (f: string) => readFileSync(new URL(`../src/pages/${f}.tsx`, import.meta.url), "utf8");
  const every = (f: string, width: string) => {
    const pages = read(f).match(/<Page\b(?:=>|[^>])*>/g) ?? [];
    assert.ok(pages.length > 0, f);
    for (const tag of pages) assert.match(tag, new RegExp(`width="${width}"`), `${f}: ${tag.slice(0, 80)}`);
  };
  for (const f of ["LibraryPage", "GroupsPage", "GalleryPage", "SharedLibraryPage", "DiscoverPage", "PeoplePage", "ArenaListPage", "MuralsListPage", "AdminGenresPage", "AdminSynopsesPage", "AdminTranslationsPage", "AdminDailyChapterPage"]) every(f, "wide");
  for (const f of ["TierListCreatePage", "QuizCreatePage", "QuizEditorPage", "PlayQuizPage", "DailyChapterPage", "CharacterGamePage"]) every(f, "narrow");
});

test("the Library tabs share the owner's width, so switching tabs never moves the title", () => {
  for (const f of ["LibraryPage", "GroupsPage", "GalleryPage"]) {
    assert.match(readFileSync(new URL(`../src/pages/${f}.tsx`, import.meta.url), "utf8"), /maxWidth=\{style\.contentMaxWidth\}/, f);
  }
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
