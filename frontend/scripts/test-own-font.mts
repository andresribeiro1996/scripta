import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

const EXEMPT_FILES = new Set([
  // preview: applies the font to leaf text nodes (a mocked book title/author
  // string) on the landing page, never a root that could contain a heading.
  "components/landing/HowItWorks.tsx"
]);

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

test("index.css inherits h1-h3 font-family under [data-own-font]", () => {
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  assert.match(css, /\[data-own-font\]\s*:is\(h1,\s*h2,\s*h3\)\s*\{\s*font-family:\s*inherit;\s*\}/);
});

test("every element styled with cardFontFamilyCss/blockFontFamilyCss opts its headings out via data-own-font", () => {
  const offenders: string[] = [];
  for (const file of tsxFiles(SRC)) {
    const relative = file.slice(SRC.length);
    if (EXEMPT_FILES.has(relative)) continue;
    const contents = readFileSync(file, "utf8");
    if (!/cardFontFamilyCss\(|blockFontFamilyCss\(/.test(contents)) continue;
    if (!contents.includes("data-own-font")) offenders.push(relative);
  }
  assert.deepEqual(offenders, [], "sets its own font but has no data-own-font attribute to keep headings from overriding it");
});
