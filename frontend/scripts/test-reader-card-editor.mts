import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEFAULT_FEED_SETTINGS } from "@scripta/shared/community";
import { DEFAULT_READER_CARD_STYLE, bookKey, readerCardInputOf } from "@scripta/shared";
import { HighlightChoice, SignatureChoice } from "../src/components/readerCard/ReaderCardChoices";
import { ReaderCardOptions } from "../src/components/readerCard/ReaderCardOptions";
import { ReaderGlyphSetting } from "../src/components/readerCard/ReaderGlyphSetting";
import { ToastProvider } from "../src/components/Toaster";

const books = Array.from({ length: 6 }, (_, i) => ({ Title: `Book ${i}`, Attribution: `Author ${i}`, ReadStatus: 2, _genres: ["Fantasy"] }));
const owner = readerCardInputOf(books, [], "andre", undefined, { style: { ...DEFAULT_READER_CARD_STYLE, counter: "beads", trait: "seal", layout: "book" }, coverOf: () => null });

test("five counter thumbnails, with only the chosen one checked", () => {
  const html = renderToString(createElement(ReaderCardOptions, { input: owner, onChange: () => undefined }));
  assert.equal(html.match(/role="radio"/g)?.length, 5);
  assert.equal(html.match(/aria-checked="true"/g)?.length, 1);
  assert.match(html, /aria-checked="true"[^>]*>(?:(?!<\/button>).)*Beads/s);
  for (const name of ["Dial", "Beads", "Shelf", "Frame", "Ring"]) assert.match(html, new RegExp(`>${name}<`));
});

test("trait and layout show their names and press the current one", () => {
  const html = renderToString(createElement(ReaderCardOptions, { input: owner, onChange: () => undefined }));
  for (const name of ["Line and seal", "Seal", "Line", "None", "Three faces", "Book", "One back"]) assert.match(html, new RegExp(`>${name}<`));
  assert.match(html, /aria-pressed="true"[^>]*>Seal</);
  assert.match(html, /aria-pressed="true"[^>]*>Book</);
});

const save = async () => true;
const finished = { Title: "A Wizard of Earthsea", Attribution: "Ursula K. Le Guin", ReadStatus: 2, highlights: [{ Type: "highlight", Text: "To light a candle", BookmarkID: "h1" }] };

test("a reader with no finished books is told how to get a signature book", () => {
  assert.match(renderToString(createElement(SignatureChoice, { books: [{ Title: "Reading", ReadStatus: 1 }], signature: null, onChange: save })), /Finish a book to choose your signature book\./);
});

test("the chosen signature book shows with its note, capped at sixty characters", () => {
  const html = renderToString(createElement(SignatureChoice, { books: [finished], signature: { bookKey: bookKey(finished), note: "lent twice" }, chosen: { title: "A Wizard of Earthsea", author: "Ursula K. Le Guin", workId: null, coverUrl: null, note: "lent twice" }, onChange: save }));
  assert.match(html, /A Wizard of Earthsea/);
  assert.match(html, /value="lent twice"/);
  assert.match(html, /maxLength="60"/i);
  assert.match(html, />10\/60</);
  assert.match(html, />Change</);
  assert.match(html, />Remove</);
});

test("a stored choice the library lost says so and can be removed", () => {
  const book = renderToString(createElement(SignatureChoice, { books: [finished], signature: { bookKey: "isbn:gone", note: null }, onChange: save }));
  assert.match(book, /No longer in your library\./);
  assert.match(book, />Remove</);
  const quote = renderToString(createElement(HighlightChoice, { books: [finished], highlight: { bookKey: "isbn:gone", highlightId: "x" }, onChange: save }));
  assert.match(quote, /No longer in your library\./);
});

test("a reader with no Kobo highlights is told so; a chosen highlight shows as a quote", () => {
  assert.match(renderToString(createElement(HighlightChoice, { books: [{ Title: "Notes only", highlights: [{ Type: "note", Text: "mine", BookmarkID: "n1" }] }], highlight: null, onChange: save })), /No Kobo highlights yet\./);
  const html = renderToString(createElement(HighlightChoice, { books: [finished], highlight: { bookKey: bookKey(finished), highlightId: "h1" }, chosen: { text: "To light a candle", title: "A Wizard of Earthsea", author: "Ursula K. Le Guin" }, onChange: save }));
  assert.match(html, /“To light a candle”/);
});

test("the glyph switch reads the profile and says it waits for a published shelf", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(["community", "own-profile"], { muralId: null, published: false, feedSettings: { ...DEFAULT_FEED_SETTINGS, readerGlyph: true } });
  const html = renderToString(createElement(QueryClientProvider, { client }, createElement(ToastProvider, null, createElement(ReaderGlyphSetting, { username: "andre", books: [], groups: [] }))));
  assert.match(html, /role="switch"[^>]*aria-checked="true"/);
  assert.match(html, /It shows once your shelf is published\./);
});

test("the glyph switch is gone from the shelf's profile sheet", () => {
  assert.doesNotMatch(readFileSync("src/components/OwnShelfView.tsx", "utf8"), /readerGlyph/);
});
