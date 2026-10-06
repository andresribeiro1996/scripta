import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LIBRARY_STYLE } from "@scripta/shared";
import { libraryGridColumns } from "./gridColumns.js";

test("phone grids default to four columns, scale with card size, and fit touch targets", () => {
  for (const width of [320, 360, 390, 430, 639]) {
    assert.equal(libraryGridColumns(width, width - 32, DEFAULT_LIBRARY_STYLE), 4);
  }
  assert.equal(libraryGridColumns(390, 358, { ...DEFAULT_LIBRARY_STYLE, cardMinWidth: 320 }), 2);
  const columns = libraryGridColumns(360, 328, { ...DEFAULT_LIBRARY_STYLE, cardMinWidth: 40 });
  assert.equal(columns, 5);
  assert.ok((328 - DEFAULT_LIBRARY_STYLE.cardGap * (columns - 1)) / columns >= 44);
  assert.equal(libraryGridColumns(360, 168, DEFAULT_LIBRARY_STYLE), 3);
  assert.equal(libraryGridColumns(640, 608, DEFAULT_LIBRARY_STYLE), 2);
  assert.equal(libraryGridColumns(768, 736, DEFAULT_LIBRARY_STYLE), 3);
  assert.equal(libraryGridColumns(1024, 992, DEFAULT_LIBRARY_STYLE), 4);
});
