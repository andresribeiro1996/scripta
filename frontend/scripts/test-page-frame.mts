import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { Page } from "../src/components/page/Page";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_CLASS, TITLE_FIELD_CLASS } from "../src/components/page/buttonClasses";
import { AuthorAvatar } from "../src/components/CommunityAuthorAvatar";
import { SwipeTabs } from "../src/components/SwipeTabs";
import { invalidateAfterFollow } from "../src/hooks/useCommunity";
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

test("side tabs: a row below lg, a vertical nav from lg, current marked in both", () => {
  const html = render(createElement(Page, { title: "Settings", tabs: area("settings").tabs, sideTabs: true, children: "BODY" }), "/dashboard/settings");
  assert.match(html, /<nav aria-label="Sections"[^>]*lg:hidden/);
  assert.match(html, /<nav aria-label="Sections"[^>]*hidden lg:flex/);
  assert.equal(html.match(/aria-current="page"/g)?.length, 2);
  assert.match(html, /max-w-3xl[^>]*>BODY/);
});

test("all Settings tabs use side tabs", () => {
  for (const f of ["SettingsPage", "SettingsAppearancePage", "LibraryStylePage"]) assert.match(readFileSync(new URL(`../src/pages/${f}.tsx`, import.meta.url), "utf8"), /sideTabs/, f);
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
    const src = read(`${file}.tsx`);
    assert.match(src, /back=\{backTo\("profile"\)\}/, file);
    assert.match(src, /title=\{null\}/, file);
    assert.match(src, /<h1[^>]*font-display/, file);
    assert.doesNotMatch(src, /max-w-(3xl|4xl)/, file);
  }
  assert.doesNotMatch(read("pages/MuralsListPage.tsx"), /uppercase/);
  assert.doesNotMatch(read("pages/HomePage.tsx"), /const button\b/);
});

test("Games pages: one primary in the header, no hand-rolled fills, no inner widths, a centred tournament", () => {
  const read = (f: string) => readFileSync(new URL(`../src/${f}.tsx`, import.meta.url), "utf8");
  const list = read("pages/ArenaListPage");
  assert.match(list, /actions=\{[\s\S]*?BUTTON_PRIMARY/);
  assert.match(list, /subtitle=\{/);
  assert.doesNotMatch(list, /<input\b(?:=>|[^>])*className="[^"]*border border-\(--color-border\)/);
  for (const f of ["pages/TierListCreatePage", "pages/QuizCreatePage", "pages/QuizEditorPage", "pages/PlayQuizPage", "components/quiz/QuizResults", "pages/CharacterGamePage"]) {
    const s = read(f);
    assert.doesNotMatch(s, /mx-auto[^"`]*max-w-(xl|2xl|3xl|6xl)\b|max-w-(xl|2xl|3xl|6xl)\b[^"`]*mx-auto/, f);
    assert.doesNotMatch(s, /<button\b(?:=>|[^>])*className=\{?[`"][^`"]*bg-\(--color-accent\)/, f);
  }
  assert.match(read("pages/ArenaViewPage"), /<EmptyState/);
});

const src = (f: string) => readFileSync(new URL(`../src/${f}.tsx`, import.meta.url), "utf8");

test("rename fields inside a title keep the heading size and stay 44px", () => {
  assert.ok(TITLE_FIELD_CLASS.startsWith(FIELD_CLASS));
  assert.match(TITLE_FIELD_CLASS, /(?:^|\s)text-\[length:inherit\]!(?:\s|$)/);
  assert.match(TITLE_FIELD_CLASS, /(?:^|\s)leading-\[inherit\]!(?:\s|$)/);
  assert.match(TITLE_FIELD_CLASS, /min-h-11/);
  for (const f of ["pages/TierListEditorPage", "pages/ArenaSeedPage", "pages/ArenaViewPage"]) {
    const s = src(f);
    assert.match(s, /<input\b(?:=>|[^>])*className=\{TITLE_FIELD_CLASS\}/, f);
    assert.doesNotMatch(s, /\$\{FIELD_CLASS\} font-display/, f);
  }
});

test("the tier list editor's one header primary is Open for voting, and the panel no longer hosts it", () => {
  const s = src("pages/TierListEditorPage");
  assert.equal(s.match(/>\s*Open for voting\s*</g)?.length, 1);
  const actions = s.slice(s.indexOf("actions={"), s.indexOf("{subject ?"));
  assert.match(actions, /<button onClick=\{\(\) => setOpenPanelOpen\(true\)\} className=\{BUTTON_PRIMARY\}>\s*Open for voting/);
  assert.equal(actions.match(/BUTTON_PRIMARY/g)?.length, 1);
  assert.match(actions, /className=\{BUTTON_SECONDARY\}\s*>\s*\{editing \? "Done" : "Edit"\}/);
});

test("the author avatar letter scales with its size", () => {
  const letter = (size: number) => renderToString(createElement(AuthorAvatar, { author: { userId: "u", username: "ana", avatarUrl: null } as never, size }));
  assert.match(letter(72), /font-size:32px/);
  assert.match(letter(40), /font-size:18px/);
  assert.doesNotMatch(letter(72), /text-\[10px\]/);
  assert.doesNotMatch(src("pages/CommunityProfilePage"), /ProfileAvatar/);
  assert.match(src("pages/CommunityProfilePage"), /<AuthorAvatar author=\{user\} size=\{72\} \/>/);
});

test("SwipeTabs: a 44px nav from lg with the current tab marked, the swipe tablist hidden from lg", () => {
  const tabs = [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta", count: 3 }] as const;
  const html = renderToString(createElement(SwipeTabs<"a" | "b">, { tabs, value: "b", onChange: () => {}, label: "Sections", children: () => "x" }));
  const nav = html.match(/<div class="hidden lg:block"><nav aria-label="Sections" class="[^"]*overflow-x-auto[^"]*">[\s\S]*?<\/nav><\/div>/)?.[0];
  assert.ok(nav);
  assert.equal(nav.match(/<button(?=[^>]*type="button")(?=[^>]*min-h-11)(?=[^>]*border-b-2)[^>]*>/g)?.length, 2);
  assert.equal(nav.match(/aria-current="true"/g)?.length, 1);
  assert.match(nav, /<button(?=[^>]*aria-current="true")[^>]*>Beta/);
  assert.match(html, /<div(?=[^>]*role="tablist")(?=[^>]*aria-label="Sections")(?=[^>]*(?:^|\s|")lg:hidden)[^>]*>/);
});

test("following refreshes the people lists and Home's circle, from all four places", async () => {
  const keys: unknown[] = [];
  await invalidateAfterFollow({ invalidateQueries: async ({ queryKey }: { queryKey: unknown }) => { keys.push(queryKey); } } as never);
  assert.deepEqual(keys, [["community", "people"], ["community", "dashboard", "circle"]]);
  for (const f of ["pages/PeoplePage", "pages/CommunityProfilePage", "components/home/SuggestedReaders", "components/home/ForYouPanel"]) {
    const s = src(f);
    assert.match(s, /await invalidateAfterFollow\(queryClient\)/, f);
    assert.doesNotMatch(s, /"dashboard", "circle"/, f);
  }
});

test("the Games tournament search is the shared SearchField", () => {
  const list = src("pages/ArenaListPage");
  assert.match(list, /<SearchField\b(?:=>|[^>])*label="Search tournaments by name"/);
  assert.doesNotMatch(list, /<input\b(?:=>|[^>])*aria-label="Search tournaments/);
});

test("the quiz editor says why Publish is off next to the header, and play and results get the Games back link", () => {
  const editor = src("pages/QuizEditorPage");
  assert.equal(editor.match(/A quiz needs at least 4 books\./g)?.length, 1);
  assert.match(editor, /<Page\b(?:=>|[^>])*subtitle=\{[^}]*data\.books\.length < 4[^}]*A quiz needs at least 4 books\./);
  const play = src("pages/PlayQuizPage");
  assert.match(play, /session\?\.user\.username \? backTo\("quiz"\) : undefined/);
  const tags = play.match(/<Page\b(?:=>|[^>])*>/g) ?? [];
  assert.equal(tags.length, 3);
  for (const tag of tags) assert.match(tag, /^<Page width="narrow" back=\{back\} title=/);
  const screens = play.match(/<InfoScreen\b(?:=>|[^>])*\/>/g) ?? [];
  assert.equal(screens.length, 4);
  for (const tag of screens) assert.match(tag, /back=\{back\}/, tag);
  assert.match(play, /<QuizResults\b(?:=>|[^>])*back=\{back\}/);
  assert.match(src("components/quiz/QuizResults"), /<Page back=\{back\} title=\{null\}>/);
});
