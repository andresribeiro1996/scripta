import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { THEME_IDS, themes } from "@scripta/shared/themes";
import { renderThemesCss } from "./themesCss.mts";

test("src/themes.css matches the shared theme registry", () => {
  const committed = readFileSync(new URL("../src/themes.css", import.meta.url), "utf8");
  assert.equal(committed, renderThemesCss(), "src/themes.css is stale: run `npm run themes --workspace frontend`");
});

test("the dark variant covers exactly the dark-scheme themes", () => {
  const variant = renderThemesCss().split("\n").find((line) => line.startsWith("@custom-variant dark"));
  assert.ok(variant);
  for (const id of THEME_IDS) assert.equal(variant.includes(`[data-theme="${id}"]`), themes[id].scheme === "dark", id);
});

test("every theme gets a block that sets its colour scheme and accent", () => {
  const css = renderThemesCss();
  for (const id of THEME_IDS) {
    const block = css.split(`:root[data-theme="${id}"] {`)[1]?.split("}")[0] ?? "";
    assert.match(block, new RegExp(`color-scheme: ${themes[id].scheme};`), id);
    assert.match(block, new RegExp(`--color-accent: ${themes[id].colors.accent};`), id);
  }
});
