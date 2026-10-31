import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: new MemoryStorage(), configurable: true });
Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), configurable: true });

const { AuthProvider } = await import("../src/auth/AuthContext");
const { setSession } = await import("../src/auth/tokenStore");
const { TextBlockView } = await import("../src/components/murals/blocks/MiscBlocks");
const { SaveStatus } = await import("../src/components/SaveStatus");
const { MobileBlockPreview } = await import("../src/components/murals/MobileBlockPreview");
const { Disclosure } = await import("../src/components/Disclosure");
const { SearchField } = await import("../src/components/Toolbar");
const { PrivacyPage } = await import("../src/pages/PrivacyPage");
const { NotFoundPage } = await import("../src/pages/NotFoundPage");
const { AddBookModal } = await import("../src/components/AddBookModal");
const { canHoldBallot } = await import("../src/hooks/useTierlistVoting");
const { areaIdForPath } = await import("../src/lib/areas");

const src = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
const textBlock = { id: "t", type: "text", layout: { x: 0, y: 0, w: 4, h: 2 } } as const;

test("an empty text block shows its editor prompt only while editing", () => {
  assert.match(renderToString(createElement(TextBlockView, { block: textBlock, editing: true })), /Add a heading or some text\./);
  assert.equal(renderToString(createElement(TextBlockView, { block: textBlock })), "");
  assert.match(renderToString(createElement(TextBlockView, { block: { ...textBlock, body: "Hello" } })), /Hello/);
});

test("an empty text block on the phone canvas is hidden from viewers and shown to the editor", () => {
  const props = { block: textBlock, books: [], images: [], width: 328, height: 120 };
  assert.equal(renderToString(createElement(MobileBlockPreview, props)), "");
  assert.match(renderToString(createElement(MobileBlockPreview, { ...props, editing: true })), /Tap to open/);
  assert.match(src("components/murals/MobileMuralCanvas.tsx"), /<MobileBlockPreview(?:=>|[^>])*editing=\{editing\}/);
  assert.match(src("components/murals/MobileMuralCanvas.tsx"), /editing=\{editMode\}/);
});

test("owners cannot play their own quiz from the editor or the games list", () => {
  assert.doesNotMatch(src("pages/QuizEditorPage.tsx"), /Play it yourself/);
  assert.doesNotMatch(src("pages/ArenaListPage.tsx"), /label: "Play"/);
});

test("the save status line keeps its height while idle", () => {
  assert.match(renderToString(createElement(SaveStatus, { state: "idle" })), /min-h-5/);
});

test("the canvas tells blocks whether it is editing", () => {
  assert.match(src("components/murals/MuralCanvas.tsx"), /<BlockRenderer(?:=>|[^>])*editing=\{editMode\}/);
  assert.match(src("components/murals/BlockRenderer.tsx"), /<TextBlockView block=\{block\} editing=\{editing\}/);
});

test("signed-out viewers never trigger the authenticated book details request", () => {
  assert.match(src("hooks/useMuralBookMetadata.ts"), /if \(!signedIn\) return;/);
  assert.match(src("components/murals/MuralBlockDetail.tsx"), /signedIn \? <BookSummary book=\{book\} \/> : null/);
});

test("the shared mural names its owner", () => {
  assert.match(src("pages/SharedMuralPage.tsx"), /subtitle=\{data\.profile \? `by @\$\{data\.profile\.username\}` : undefined\}/);
});

test("save status announces saving and saved, and is blank when idle", () => {
  assert.match(renderToString(createElement(SaveStatus, { state: "saving" })), /role="status"[^>]*>Saving…</);
  assert.match(renderToString(createElement(SaveStatus, { state: "saved" })), /role="status"[^>]*>Saved</);
  assert.match(renderToString(createElement(SaveStatus, { state: "idle" })), /role="status"[^>]*><\/span>/);
  assert.match(src("pages/ReaderCardPage.tsx"), /subtitle=\{<SaveStatus state=\{saveState\} \/>\}/);
  assert.match(src("pages/ReaderCardPage.tsx"), /await track\(save\(patch\)\)/);
});

test("the library style preview sits before the controls and stays in view", () => {
  const page = src("pages/LibraryStylePage.tsx");
  assert.ok(page.indexOf("Preview{") < page.indexOf('<Section title="Card layout">'));
  assert.match(page, /sticky top-\[calc\(var\(--app-top\)\+0\.5rem\)\]/);
  assert.match(page, /grid items-start gap-6/);
});

test("the add-a-book dialog starts on Reading and keeps the picked book visible", () => {
  const html = renderToString(createElement(AddBookModal, { onAdd: async () => undefined, onClose: () => undefined }));
  assert.match(html, /<option value="1" selected/);
  const modal = src("components/AddBookModal.tsx");
  assert.match(modal, /\{picked && \(/);
  assert.match(modal, /results !== null && !scanning && !picked/);
});

test("Disclosure draws the shared plus icon instead of the browser triangle", () => {
  const html = renderToString(createElement(Disclosure, { title: "Past results", children: "rows" }));
  assert.match(html, /<summary class="[^"]*min-h-11[^"]*list-none/);
  assert.match(html, /<svg/);
  assert.match(html, />Past results</);
});

test("the Daily Chapter page links back Home and lights the Home area", () => {
  assert.equal(areaIdForPath("/daily"), "home");
  const page = src("pages/DailyChapterPage.tsx");
  assert.match(page, /back=\{\{ to: session\?\.user\.username \? "\/dashboard" : "\/", label: "Home" \}\}/);
  assert.match(page, /<Disclosure title="Past results">/);
  assert.doesNotMatch(page, /<details>/);
});

test("a signed-out visitor's 404 leads to the landing page, a signed-in one to the library", () => {
  const page = () => renderToString(createElement(MemoryRouter, null, createElement(AuthProvider, null, createElement(NotFoundPage))));
  setSession(null);
  const out = page();
  assert.match(out, /href="\/"[^>]*>Back to Scripta</);
  assert.doesNotMatch(out, /Go to your library/);
  setSession({ user: { id: "u1", email: "a@b.c", username: "alice", avatarId: null }, accessToken: "a", refreshToken: "r" }, false);
  assert.match(page(), /href="\/dashboard"[^>]*>Go to your library</);
  setSession(null);
  assert.match(src("App.tsx"), /<Route element=\{<SessionLayout \/>\}>\s*<Route path="\*"/);
});

test("expected-empty lookups are not requested when the board says nothing exists", () => {
  assert.equal(canHoldBallot("abc", 0, null, true), false);
  assert.equal(canHoldBallot("abc", undefined, "id", true), false);
  assert.equal(canHoldBallot("abc", 3, null, false), false);
  assert.equal(canHoldBallot("", 3, "id", true), false);
  assert.equal(canHoldBallot("abc", 3, null, true), true);
  assert.equal(canHoldBallot("abc", 3, "id", false), true);
  assert.match(src("hooks/useQuizPlay.ts"), /enabled: \(board\.data\?\.playCount \?\? 0\) > 0/);
});

test("both Discover pages and People say what they are", () => {
  assert.equal([...src("pages/DiscoverPage.tsx").matchAll(/subtitle="Tier lists, tournaments and quizzes readers have published\."/g)].length, 2);
  assert.match(src("pages/PeoplePage.tsx"), /subtitle="Find readers and follow them/);
});

test("a search box with text shows one 44px Clear control and an empty one shows none", () => {
  const field = (value: string) => renderToString(createElement(SearchField, { value, onChange: () => undefined, placeholder: "Search", label: "Search books" }));
  assert.match(field("dune"), /<button[^>]*aria-label="Clear search"[^>]*size-11/);
  assert.doesNotMatch(field(""), /Clear search/);
  assert.match(src("components/Toolbar.tsx"), /\[&::-webkit-search-cancel-button\]:appearance-none/);
});

test("the privacy page sections are the shared Disclosure", () => {
  const html = renderToString(createElement(MemoryRouter, null, createElement(AuthProvider, null, createElement(PrivacyPage))));
  assert.match(html, /<details class="group[^"]*border-b[^"]*"><summary class="[^"]*list-none[^"]*"><h2 class="[^"]*min-h-14[^"]*">Sharing<svg/);
  assert.doesNotMatch(src("pages/PrivacyPage.tsx"), /<details/);
});
