import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkPage } from "@scripta/shared";
import { readFileSync } from "node:fs";
import { BookScreen, ReaderList } from "../src/components/book/BookScreen";
import { editionCoverBook } from "../src/components/book/BookCover";
import { ConfirmProvider } from "../src/components/ConfirmDialog";
import { ToastProvider } from "../src/components/Toaster";
import { createWebLibrarySaver, LibrarySaverContext } from "../src/hooks/useLibrarySaver";

const edition = (n: number, mine = false) => ({ bookId: `e${n}`, title: `Dune ${n}`, language: "en", year: 1965 + n, isbn: n === 1 ? "9780441013593" : null, coverUrl: null, coverColor: null, pages: 400 + n, mine });
const page: WorkPage = {
  work: { id: "w", title: "Dune", author: "Frank Herbert", summary: null, coverUrl: null, coverColor: null, editions: [1, 2, 3, 4, 5].map((n) => edition(n)), genres: ["Science Fiction", "Classics"], rating: { value: 4.27, count: 2310 }, year: 1965, pages: 412 },
  mine: null,
  readers: { followed: [], others: [], counts: { readers: 0, finished: 0 } },
  games: { tierlists: [], arenas: [], quizzes: [] }
};
const ownedPage: WorkPage = {
  ...page,
  work: { ...page.work, editions: [1, 2, 3, 4, 5].map((n) => edition(n, n === 1)) },
  mine: { bookKey: "isbn:9780441013593", readStatus: 2, rating: 4, highlightCount: 1 }
};
const owned = { Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593", ReadStatus: 2, Rating: 4, highlights: [{ BookmarkID: "h1", Text: "Fear is the mind-killer." }] };

Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false }), configurable: true });

type Props = Parameters<typeof BookScreen>[0];
const base: Props = { page, book: null, signedIn: true, frame: (body: ReactNode) => body, editionId: null, onSelectEdition: () => undefined, onAdd: () => undefined, onShare: () => undefined };
const renderOwnedBook = () => render({ book: owned, page: ownedPage });
function render(props: Partial<Props>, path = "/") {
  const client = new QueryClient();
  return renderToString(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        LibrarySaverContext.Provider,
        { value: createWebLibrarySaver(client) },
        createElement(ToastProvider, null, createElement(ConfirmProvider, null, createElement(MemoryRouter, { initialEntries: [path] }, createElement(BookScreen, { ...base, ...props }))))
      )
    )
  );
}

test("not owned: add button, About and Community tabs, no highlights tab, no menu", () => {
  const html = render({ page: { ...page, work: { ...page.work, editions: [edition(1)] } } });
  assert.ok(html.includes("Add to library"));
  assert.ok(html.includes("About"));
  assert.ok(html.includes("Community"));
  assert.ok(!html.includes("Highlights"));
  assert.ok(!html.includes('title="More"'));
  assert.ok(html.includes("Science Fiction"));
  assert.ok(html.includes("1965 · 412 pages"));
  assert.ok(html.includes('aria-label="Share"'));
});

test("owned and finished: status and feeling menus, highlights tab, more menu", () => {
  const html = render({ book: owned, page: ownedPage });
  assert.ok(!html.includes("Add to library"));
  assert.ok(html.includes("Finished"));
  assert.ok(html.includes("Loved it"));
  assert.ok(html.includes("Highlights (1)"));
  assert.ok(html.includes('title="More"'));
});

test("a long summary shows its preview and Show more; editions list three with Show all", () => {
  const long = `${"Spice and sand. ".repeat(40)}The end.`;
  const html = render({ page: { ...page, work: { ...page.work, summary: long } } });
  assert.ok(html.includes("Show more"));
  assert.ok(!html.includes("The end."));
  assert.ok(html.includes('font-semibold">Dune 3'));
  assert.ok(!html.includes('font-semibold">Dune 4'));
  assert.ok(/Show all (<!-- -->)?5/.test(html));
});

test("not owned with several editions: the strip, an unowned counter and Add this edition", () => {
  const html = render({});
  assert.ok(html.includes('aria-roledescription="carousel"'));
  assert.ok(html.includes("Edition 1 of 5"));
  assert.ok(!html.includes("Your edition"));
  assert.ok(html.includes("Add this edition"));
  assert.ok(!html.includes("Add to library"));
});

test("owned: the strip marks your edition, with owner controls and no add button", () => {
  const html = render({ book: owned, page: ownedPage });
  assert.ok(html.includes("Your edition · 1 of 5"));
  assert.ok(html.includes("Yours"));
  assert.ok(!html.includes("Back to your edition"));
  assert.ok(html.includes("Finished"));
  assert.ok(!html.includes("Add this edition"));
});

test("owned with no matching edition: the library cover shows at the default edition, labelled yours", () => {
  const withCover = { ...page, work: { ...page.work, editions: [1, 2, 3, 4, 5].map((n) => ({ ...edition(n), coverUrl: `https://covers.test/${n}.jpg` })) } };
  const html = render({ book: { ...owned, _coverUrl: "https://library.test/mine.jpg" }, page: { ...withCover, mine: ownedPage.mine } });
  assert.ok(html.includes("Your edition · 1 of 5"));
  assert.ok(html.includes("https://library.test/mine.jpg"));
  assert.ok(!html.includes("https://covers.test/1.jpg"));
  assert.ok(html.includes("https://covers.test/2.jpg"));
  assert.ok(!html.includes("Back to your edition"));
});

test("owned with another edition selected: moved counter, way back, same owner controls", () => {
  const html = render({ book: owned, page: ownedPage, editionId: "e3" });
  assert.ok(html.includes("Edition 3 of 5"));
  assert.ok(html.includes("Back to your edition"));
  assert.ok(html.includes("1968 · 403 pages"));
  assert.ok(html.includes("Finished"));
  assert.ok(!html.includes("Add this edition"));
});

test("a single edition has no strip and keeps Add to library", () => {
  const html = render({ page: { ...page, work: { ...page.work, editions: [edition(1)] } } });
  assert.ok(!html.includes("carousel"));
  assert.ok(html.includes("Add to library"));
});

test("a short summary renders whole, with no Show more", () => {
  const html = render({ page: { ...page, work: { ...page.work, summary: "Spice." } } });
  assert.ok(html.includes("Spice."));
  assert.ok(!html.includes("Show more"));
});

test("a library-only book opens on Highlights with no About or Community", () => {
  const html = render({ page: null, book: owned, onShare: null });
  assert.ok(html.includes("Fear is the mind-killer."));
  assert.ok(!html.includes("Community"));
  assert.ok(!html.includes("Share"));
  assert.ok(!html.includes("Rated"));
});

test("the hero holds the only h1, with Share and More on the title row", () => {
  const html = renderOwnedBook();
  assert.equal(html.match(/<h1/g)?.length, 1);
  assert.match(html, /<h1[^>]*class="[^"]*font-display[^"]*lg:text-5xl[^"]*"[^>]*>[^<]+<\/h1>[\s\S]*?aria-label="Share"/);
  assert.match(html, /<h1[^>]*class="[^"]*\bmin-w-0\b[^"]*\bbreak-words\b[^"]*"/);
});

test("sections are labelled underline tabs with the current one announced", () => {
  const html = renderOwnedBook();
  const nav = html.match(/<nav aria-label="Book sections"[\s\S]*?<\/nav>/)![0];
  assert.match(nav, />About</);
  assert.match(nav, />Highlights \(1\)</);
  assert.match(nav, /aria-current="page"/);
  assert.match(nav, /border-b-2/);
});

test("book sections are links to ?tab=, and the URL picks the current one", () => {
  const nav = (html: string) => html.match(/<nav aria-label="Book sections"[\s\S]*?<\/nav>/)![0];
  const first = nav(render({ book: owned, page: ownedPage }));
  assert.match(first, /<a(?=(?:=>|[^>])*href="\/\?tab=about")(?=(?:=>|[^>])*aria-current="page")(?=(?:=>|[^>])*border-b-2)(?:=>|[^>])*>About<\/a>/);
  assert.match(first, /<a(?=(?:=>|[^>])*href="\/\?tab=highlights")(?:=>|[^>])*>Highlights \(1\)<\/a>/);
  assert.doesNotMatch(first, /<button/);
  const second = render({ book: owned, page: ownedPage }, "/work/w?tab=highlights");
  assert.match(nav(second), /<a(?=(?:=>|[^>])*aria-current="page")(?:=>|[^>])*>Highlights \(1\)<\/a>/);
  assert.ok(second.includes("Fear is the mind-killer."));
  assert.match(nav(render({ book: owned, page: ownedPage }, "/work/w?tab=bogus")), /<a(?=(?:=>|[^>])*aria-current="page")(?:=>|[^>])*>About<\/a>/);
});

test("the cover menu items say what they do and who they affect", () => {
  const src = readFileSync(new URL("../src/components/book/BookScreen.tsx", import.meta.url), "utf8");
  const labels = [...src.matchAll(/label: "([^"]*cover[^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(labels, ["Change cover", "Reject cover for everyone", "Upload cover for everyone"]);
});

test("the status menu shows its label with a check, not a ▾ glyph", () => {
  const html = renderOwnedBook();
  assert.doesNotMatch(html, /▾/);
  assert.match(html, /aria-haspopup="menu"[^>]*>[\s\S]*?Finished/);
});

test("the cover column is sticky only from lg and the hero grid is two columns there", () => {
  const html = render({});
  assert.match(html, /class="[^"]*lg:grid-cols-\[minmax\(0,280px\)_minmax\(0,1fr\)\][^"]*lg:gap-14[^"]*"/);
  assert.match(html, /class="min-w-0 self-start[^"]*lg:sticky[^"]*"/);
});

test("editions are a list panel with a small cover per row and a Yours chip", () => {
  const html = renderOwnedBook();
  const list = html.match(/<ul class="[^"]*divide-y[^"]*">[\s\S]*?<\/ul>/)![0];
  assert.equal(list.match(/<li/g)?.length, 3);
  assert.equal(list.match(/width:36px/g)?.length, 3);
  assert.equal(list.match(/>Yours</g)?.length, 1);
});

test("cover-less editions pass an empty book so no cover lookup fires, in the list and the strip", () => {
  assert.deepEqual(editionCoverBook(edition(1), "Frank Herbert"), {});
  assert.deepEqual(editionCoverBook({ ...edition(1), coverUrl: "https://covers.test/1.jpg" }, "Frank Herbert"), { Title: "Dune 1", Attribution: "Frank Herbert", ISBN: "9780441013593", _coverUrl: "https://covers.test/1.jpg" });
  for (const f of ["BookScreen", "EditionStrip"]) assert.match(readFileSync(new URL(`../src/components/book/${f}.tsx`, import.meta.url), "utf8"), /editionCoverBook\(/, f);
});

test("a single owned edition's Yours row shows the library cover", () => {
  const one = { ...page, work: { ...page.work, editions: [{ ...edition(1, true), coverUrl: "https://covers.test/1.jpg" }] }, mine: ownedPage.mine };
  const list = render({ book: { ...owned, _coverUrl: "https://library.test/mine.jpg" }, page: one }).match(/<ul class="[^"]*divide-y[^"]*">[\s\S]*?<\/ul>/)![0];
  assert.ok(list.includes("https://library.test/mine.jpg"));
  assert.ok(!list.includes("https://covers.test/1.jpg"));
});

test("the edition strip draws book-style covers sized to the hero column, not 144px tiles", () => {
  const strip = render({}).match(/aria-roledescription="carousel"[\s\S]*?aria-live/)![0];
  assert.match(strip, /shadow-\(--shadow-cover\)/);
  assert.match(strip, /<button(?:=>|[^>])*class="[^"]*\bw-50\b[^"]*\blg:w-70\b/);
  assert.doesNotMatch(strip, /rounded-xl/);
});

test("the tab classes come from one shared constant", () => {
  for (const f of ["book/BookScreen", "page/Page"]) {
    const src = readFileSync(new URL(`../src/components/${f}.tsx`, import.meta.url), "utf8");
    assert.match(src, /tabClass|TAB_NAV/, f);
    assert.doesNotMatch(src, /inline-flex min-h-11 min-w-11/, f);
    assert.doesNotMatch(src, /overflow-x-auto shadow-\[inset/, f);
  }
});

const rows = [
  { username: "ana", avatarUrl: null, status: "Reading", linksToProfile: false },
  { username: "bo", avatarUrl: null, status: "Finished", linksToProfile: true }
];
const renderReaders = (signedIn: boolean, title: string | null) =>
  renderToString(createElement(MemoryRouter, null, createElement(ReaderList, { title, rows, signedIn })));

test("signed in: only published readers link to their profile", () => {
  const html = renderReaders(true, "People you follow");
  assert.ok(html.includes("/community/u/bo"));
  assert.ok(!html.includes("/community/u/ana"));
  assert.ok(html.includes("People you follow"));
});

test("signed out: no reader links to a profile", () => {
  const html = renderReaders(false, null);
  assert.ok(!html.includes("/community/u/"));
  assert.ok(html.includes("bo"));
  assert.ok(!html.includes("<h3"));
});

test("the hero carries the Open Library rating as stars with a count caption", () => {
  const html = render({});
  assert.ok(html.includes('aria-label="Rated 4.3 out of 5"'));
  assert.ok(html.includes("4.3 · 2.3K ratings"));
});

test("a library-only book has no stats tiles", () => {
  assert.ok(!render({ page: null, book: owned, onShare: null }).includes("/stats"));
});

test("a cover colour washes the header and hero; no colour, no wash", () => {
  const wash = /<div(?=[^>]*aria-hidden="true")(?=[^>]*h-\[520px\])(?=[^>]*linear-gradient\(to bottom)[^>]*>/;
  assert.match(render({ page: { ...page, work: { ...page.work, coverColor: "#e0a82e" } } }), wash);
  assert.doesNotMatch(render({}), wash);
  assert.doesNotMatch(render({ page: null, book: owned, onShare: null }), wash);
});

test("possible genres read as possible", () => {
  const html = render({ page: { ...page, work: { ...page.work, possibleGenres: ["History"] } } });
  assert.ok(html.includes("Possibly History"));
  assert.ok(html.includes("Science Fiction"));
});

test("the work page shows a win pill, a nominee pill and the author prize line", () => {
  const awards = [
    { prize: "booker", year: 2019, won: false },
    { prize: "hugo-novel", year: 1993, won: true },
    { prize: "nobel-literature", year: 1998, won: true },
    { prize: "camoes", year: 1995, won: true }
  ];
  const html = render({ page: { ...page, work: { ...page.work, awards } } });
  const pill = (label: string) => html.match(new RegExp(`<li(?=[^>]*title="${label}")([^>]*)>(.*?)</li>`));
  const win = pill("Hugo Award 1993");
  const nominee = pill("Booker Prize 2019 · nominee");
  assert.ok(win && nominee);
  assert.match(win[1]!, /class="[^"]*bg-\(--color-accent-soft\)[^"]*text-\(--color-accent\)[^"]*"/);
  assert.match(win[2]!, /^<span class="flex shrink-0"><svg[^>]*width="12"[^>]*>.*<\/svg><\/span><span class="truncate">Hugo Award 1993<\/span>$/);
  assert.match(nominee[1]!, /class="[^"]*border-\(--color-border\)[^"]*text-\(--color-text-dim\)[^"]*"/);
  assert.equal(nominee[2], '<span class="truncate">Booker Prize 2019 · nominee</span>');
  for (const { 1: attributes } of [win, nominee]) assert.match(attributes!, /class="[^"]*\bmax-w-full\b[^"]*"/);
  assert.match(html, /<p class="mt-1 text-xs text-\(--color-text-dim\)">Nobel Prize in Literature 1998 · Prémio Camões 1995<\/p>/);
  assert.ok(html.indexOf("Hugo Award 1993") < html.indexOf("Booker Prize 2019 · nominee"));
  assert.ok(html.indexOf("Booker Prize 2019 · nominee") < html.indexOf("Science Fiction"));
  assert.ok(!html.includes("Nobel Prize in Literature 1998</span>"));
});

test("a work page with no awards has no pills and no author prize line", () => {
  const html = render({});
  assert.ok(!html.includes("nominee"));
  assert.ok(!html.includes("Prize"));
});

test("the cover column can shrink below the edition strip's width, so a phone page never widens to fit the strip", () => {
  const html = render({});
  assert.match(html, /<div class="min-w-0 self-start[^"]*"><div><div[^>]*aria-roledescription="carousel"/);
});

test("a work page lists the first eight characters and counts the rest", () => {
  const characters = Array.from({ length: 10 }, (_, i) => `Person ${i + 1}`);
  const html = render({ page: { ...page, work: { ...page.work, characters } } });
  assert.match(html, /<h2[^>]*>Characters<\/h2>/);
  assert.ok(html.includes("Person 1 · Person 2"));
  assert.ok(html.includes("Person 8"));
  assert.ok(!html.includes("Person 9"));
  assert.ok(html.includes("+2 more"));
});

test("a work page without characters has no characters line", () => {
  assert.ok(!render({}).includes("Characters"));
});
