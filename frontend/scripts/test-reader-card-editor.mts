import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { DEFAULT_READER_CARD_STYLE, readerCardInputOf } from "@scripta/shared";
import { ReaderCardOptions } from "../src/components/readerCard/ReaderCardOptions";

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
