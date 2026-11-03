import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(file: string) {
  return readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
}

test("the mural editor previews the twin but styles blocks against the original palette", () => {
  const editor = read("MuralEditorScreen.tsx");
  assert.match(editor, /const editorScheme = showTwin \? oppositeScheme\(themes\[currentTheme\]\.scheme\) : themes\[currentTheme\]\.scheme/);
  assert.match(editor, /<MuralScreen theme=\{currentTheme\} scheme=\{editorScheme\}>/);
  assert.match(editor, /palette=\{themes\[currentTheme\]\.colors\}/);
  for (const file of ["StyleTab.tsx", "blockStyleOptions.ts"]) assert.doesNotMatch(read(file), /muralBlockStyle|muralColors/, file);
});
