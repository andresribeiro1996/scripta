import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file: string) => readFileSync(new URL(`../src/components/murals/${file}`, import.meta.url), "utf8");

test("block wrappers set --block-accent and never override the theme's --color-accent", () => {
  for (const file of ["MuralCanvas.tsx", "MobileMuralCanvas.tsx"]) {
    const source = read(file);
    assert.doesNotMatch(source, /"--color-accent"\s*:/, file);
    assert.match(source, /"--block-accent"\s*:/, file);
  }
});

test("accent-on-accent-soft pairs keep the theme accent, the stat number reads --block-accent", () => {
  const source = read("blocks/MiscBlocks.tsx");
  const softPairs = source.match(/bg-\(--color-accent-soft\)[^"]*text-\(--color-accent\)/g) ?? [];
  assert.equal(softPairs.length, 2);
  assert.match(source, /font-bold text-\[var\(--block-accent,var\(--color-accent\)\)\]/);
});
