import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("src/features/readerCard/ReaderCardOptions.tsx", "utf8");
const panel = (name: string) => source.slice(source.indexOf(`function ${name}(`)).split(/\nfunction /)[0]!;

test("the thumbnail panels open empty and fill in from a deferred render, sized from their crop", () => {
  for (const [name, crop] of [["LookPanel", "motto"], ["CornersPanel", "corner"]] as const) {
    assert.match(panel(name), /useDeferredValue\(input, null\)/, name);
    assert.match(panel(name), new RegExp(`<TileRow[^>]*crop="${crop}"`), name);
  }
  assert.doesNotMatch(panel("FrontOptions"), /<TileRow[^>]*crop=/);
});
