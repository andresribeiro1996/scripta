import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, Fragment, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkPage } from "@scripta/shared";
import { BookScreen, ReaderList } from "../src/components/book/BookScreen";
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
const base: Props = { page, book: null, signedIn: true, frame: (_title: string, actions: ReactNode, body: ReactNode) => createElement(Fragment, null, actions, body), editionId: null, onSelectEdition: () => undefined, onAdd: () => undefined, onShare: () => undefined };
function render(props: Partial<Props>) {
  const client = new QueryClient();
  return renderToString(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        LibrarySaverContext.Provider,
        { value: createWebLibrarySaver(client) },
        createElement(ToastProvider, null, createElement(ConfirmProvider, null, createElement(MemoryRouter, null, createElement(BookScreen, { ...base, ...props }))))
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
  assert.ok(html.includes("Finished ▾"));
  assert.ok(html.includes("Loved it ▾"));
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
  assert.ok(html.includes("Finished ▾"));
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
  assert.ok(html.includes("Finished ▾"));
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

test("the title and back link belong to the band: the screen renders no h1 of its own", () => {
  assert.ok(!render({}).includes("<h1"));
  const titles: string[] = [];
  render({ frame: (title, _actions, body) => (titles.push(title), body) });
  assert.deepEqual(titles, ["Dune"]);
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
  assert.ok(html.includes("Characters: Person 1, Person 2"));
  assert.ok(html.includes("Person 8"));
  assert.ok(!html.includes("Person 9"));
  assert.ok(html.includes("+2 more"));
});

test("a work page without characters has no characters line", () => {
  assert.ok(!render({}).includes("Characters"));
});
