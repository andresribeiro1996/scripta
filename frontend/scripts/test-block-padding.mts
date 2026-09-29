import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("index.css scales block padding by the block's --block-pad", () => {
  const css = read("../src/index.css");
  for (const name of ["block-p-*", "block-px-*", "block-py-*"]) {
    assert.match(css, new RegExp(`@utility ${name.replace("*", "\\*")} \\{[^}]*var\\(--block-pad, 1\\)`));
  }
});

test("every block view pads itself with the scaled utilities", () => {
  for (const file of ["blocks/BookBlocks.tsx", "blocks/MiscBlocks.tsx", "blocks/QuoteBlocks.tsx", "MobileBlockPreview.tsx"]) {
    assert.match(read(`../src/components/murals/${file}`), /block-p[xy]?-/, file);
  }
});

test("no block view pads its root with an unscaled utility", () => {
  for (const file of ["blocks/BookBlocks.tsx", "blocks/MiscBlocks.tsx", "blocks/QuoteBlocks.tsx", "MobileBlockPreview.tsx"]) {
    assert.doesNotMatch(read(`../src/components/murals/${file}`), /overflow-\S+ p[xy]?-[\d.]+"/, file);
  }
});
