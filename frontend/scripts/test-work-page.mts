import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkPage } from "@scripta/shared";
import { BookScreen, ReaderList } from "../src/components/book/BookScreen";
import { ConfirmProvider } from "../src/components/ConfirmDialog";
import { ToastProvider } from "../src/components/Toaster";
import { BackLink } from "../src/components/work/BackLink";
import { createWebLibrarySaver, LibrarySaverContext } from "../src/hooks/useLibrarySaver";

const edition = (n: number) => ({ bookId: `e${n}`, title: `Dune ${n}`, language: "en", year: 1965 + n, isbn: n === 1 ? "9780441013593" : null, mine: n === 1 });
const page: WorkPage = {
  work: { id: "w", title: "Dune", author: "Frank Herbert", summary: null, coverUrl: null, coverColor: null, editions: [1, 2, 3, 4, 5].map(edition), genres: ["Science Fiction", "Classics"], rating: { value: 4.27, count: 2310 }, year: 1965, pages: 412 },
  mine: null,
  readers: { followed: [], others: [], counts: { readers: 0, finished: 0 } },
  games: { tierlists: [], arenas: [], quizzes: [] }
};
const owned = { Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441013593", ReadStatus: 2, Rating: 4, highlights: [{ BookmarkID: "h1", Text: "Fear is the mind-killer." }] };

type Props = Parameters<typeof BookScreen>[0];
const base: Props = { page, book: null, signedIn: true, backTo: "/", onBack: null, onAdd: () => undefined, onShare: () => undefined };
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
  const html = render({});
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
  const html = render({ book: owned, page: { ...page, mine: { bookKey: "isbn:9780441013593", readStatus: 2, rating: 4, highlightCount: 1 } } });
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
  assert.ok(html.includes("Dune 3"));
  assert.ok(!html.includes("Dune 4"));
  assert.ok(/Show all (<!-- -->)?5/.test(html));
  assert.ok(html.includes("Yours"));
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

test("Back links to the given fallback without history, and is a button with it", () => {
  assert.ok(render({ backTo: "/dashboard" }).includes('href="/dashboard"'));
  const button = render({ backTo: "/dashboard", onBack: () => undefined });
  assert.ok(!button.includes('href="/dashboard"'));
  assert.ok(button.includes("Back"));
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

test("BackLink renders on its own, as used by the loading and not-found states", () => {
  const html = renderToString(createElement(MemoryRouter, null, createElement(BackLink, { backTo: "/", onBack: null })));
  assert.ok(html.includes("Back"));
  assert.ok(html.includes('href="/"'));
});

test("the hero carries the Open Library rating as stars with a count caption", () => {
  const html = render({});
  assert.ok(html.includes('aria-label="Rated 4.3 out of 5"'));
  assert.ok(html.includes("4.3 · 2.3K ratings"));
});

test("a library-only book has no stats tiles", () => {
  assert.ok(!render({ page: null, book: owned, onShare: null }).includes("/stats"));
});
