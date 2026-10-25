import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Sheet } from "../src/components/Sheet";

Object.defineProperty(globalThis, "matchMedia", { value: () => ({ matches: false }), configurable: true });

const DIALOG_FILES = [
  "components/ShareModal",
  "components/CoverPickerModal",
  "components/AddBookModal",
  "components/SyncGoodreadsModal",
  "components/PerCardStylePanel",
  "components/SocialsSection",
  "pages/GroupsPage",
  "components/ConfirmDialog"
];

test("title left at text-lg, 44px Close on the right, optional footer", () => {
  const html = renderToString(
    createElement(Sheet, { title: "Change username", onClose: () => undefined, footer: createElement("button", null, "Save"), children: "body" })
  );
  assert.match(html, /<h2 class="[^"]*text-lg font-bold/);
  assert.match(html, /<button(?=[^>]*aria-label="Close")(?=[^>]*h-11 w-11)[^>]*>/);
  assert.match(html, />Save<\/button>/);
});

test("these dialogs are built on Sheet, with no hand-rolled overlay or Close text button", () => {
  for (const file of DIALOG_FILES) {
    const src = readFileSync(new URL(`../src/${file}.tsx`, import.meta.url), "utf8");
    assert.match(src, /<Sheet\b/, file);
    assert.doesNotMatch(src, /fixed inset-0/, file);
    assert.doesNotMatch(src, />\s*Close\s*</, file);
  }
});
