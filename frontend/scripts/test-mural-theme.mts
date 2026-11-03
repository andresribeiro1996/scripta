import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { THEME_IDS, themes } from "@scripta/shared/themes";
import { muralColors } from "@scripta/shared";
import { muralThemeStyle, themeColorVariables } from "../src/lib/theme";

const css = readFileSync(new URL("../src/themes.css", import.meta.url), "utf8");

function declared(id: string): Record<string, string> {
  const block = css.split(`:root[data-theme="${id}"] {`)[1]?.split("}")[0] ?? "";
  return Object.fromEntries([...block.matchAll(/^\s*(--color-[\w-]+):\s*(.+);$/gm)].map((match) => [match[1], match[2]]));
}

test("the inline mural palette variables equal what themes.css declares for every theme", () => {
  for (const id of THEME_IDS) {
    const variables = themeColorVariables(themes[id].colors);
    assert.ok(Object.keys(variables).length > 0, id);
    assert.deepEqual(variables, declared(id), id);
  }
});

test("muralThemeStyle paints the palette of the scheme it is given", () => {
  for (const id of THEME_IDS) for (const scheme of ["light", "dark"] as const) {
    const style = muralThemeStyle(id, scheme) as Record<string, string>;
    for (const [name, value] of Object.entries(themeColorVariables(muralColors(id, scheme)))) assert.equal(style[name], value, `${id} ${scheme} ${name}`);
    assert.equal(style.colorScheme, scheme);
  }
});

test("the mural editor renders every view of the mural in the editor's scheme", () => {
  const page = readFileSync(new URL("../src/pages/MuralEditorPage.tsx", import.meta.url), "utf8");
  assert.equal(page.match(/scheme=\{editorScheme\}/g)?.length, 2);
  assert.match(page, /muralThemeStyle\(view\.theme, editorScheme\)/);
  assert.match(page, /const editorScheme = showTwin \? oppositeScheme\(themes\[view\.theme\]\.scheme\) : themes\[view\.theme\]\.scheme/);
});
