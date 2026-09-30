import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { THEME_IDS, themes } from "@scripta/shared/themes";
import { themeColorVariables } from "../src/lib/theme";

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
