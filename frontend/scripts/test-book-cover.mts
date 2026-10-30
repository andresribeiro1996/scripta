import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { LibraryBook } from "@scripta/shared";
import { BookCover } from "../src/components/book/BookCover";

const render = (book: LibraryBook, width?: number) => renderToString(createElement(BookCover, { book, width }));

test("a cover with an image: book corners, cover shadow, width, decorative img", () => {
  const html = render({ Title: "Dune", Attribution: "Frank Herbert", _coverUrl: "https://img/x.jpg" }, 84);
  assert.match(html, /rounded-\[2px_5px_5px_2px\]/);
  assert.match(html, /shadow-\(--shadow-cover\)|shadow-\[var\(--shadow-cover\)\]/);
  assert.match(html, /width:84px/);
  assert.match(html, /<img[^>]*alt=""[^>]*src="https:\/\/img\/x\.jpg"|<img[^>]*src="https:\/\/img\/x\.jpg"[^>]*alt=""/);
});

test("no cover: a hidden surface tile with the title sits under the image layer, never a broken image", () => {
  const html = render({ Title: "Untitled draft" }, 112);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /<span(?=[^>]*aria-hidden="true")(?=[^>]*bg-\(--color-surface\))[^>]*>[\s\S]*?Untitled draft/);
});

test("no cover: CoverImage's own icon fallback stays out of sight so the title tile shows", () => {
  assert.match(render({ Title: "Untitled draft" }, 112), /<span(?=[^>]*\binvisible\b)[^>]*><div/);
});

test("without a width it fills its track; cover loading is CoverImage's", () => {
  assert.doesNotMatch(render({ Title: "Dune" }), /width:\d/);
  assert.match(render({ Title: "Dune" }), /w-full/);
  assert.match(readFileSync(new URL("../src/components/book/BookCover.tsx", import.meta.url), "utf8"), /<CoverImage\b/);
});
