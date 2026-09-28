import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { DISPLAY_FONT_IDS, FONT_IDS, TEXT_FONT_IDS, THEME_IDS, fontFileName, fontStack, fonts, themes } from "@scripta/shared/themes";
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

test("every bundled font weight gets a font face whose file exists", () => {
  const css = renderThemesCss();
  for (const id of FONT_IDS) {
    for (const weight of fonts[id].weights) {
      const file = `${fontFileName(id, weight)}.woff2`;
      assert.ok(css.includes(`src: url("/fonts/${file}") format("woff2");`), file);
      assert.ok(existsSync(new URL(`../public/fonts/${file}`, import.meta.url)), `missing public/fonts/${file}`);
    }
  }
});

test("single-weight display-only faces cover every weight, except Playfair which shares its family with the card face", () => {
  const css = renderThemesCss();
  const face = (id: string) => css.split("@font-face {").find((block) => block.includes(`/fonts/${id}-`)) ?? "";
  assert.match(face("vt323"), /font-weight: 100 900;/);
  assert.match(face("cormorant"), /font-weight: 100 900;/);
  assert.match(face("playfair"), /font-weight: 700;/);
  assert.match(face("literata"), /font-weight: 400;/);
  assert.match(face("vt323"), /size-adjust: 130%;/);
  assert.doesNotMatch(face("literata"), /size-adjust/);
});

test("every theme block sets both font variables to its defaults", () => {
  const css = renderThemesCss();
  for (const id of THEME_IDS) {
    const block = css.split(`:root[data-theme="${id}"] {`)[1]?.split("}")[0] ?? "";
    assert.ok(block.includes(`--font-display: ${fontStack(themes[id].fonts.display)};`), id);
    assert.ok(block.includes(`--font-text: ${fontStack(themes[id].fonts.text)};`), id);
  }
});

test("font override blocks exist for every pickable font and come after every theme block", () => {
  const css = renderThemesCss();
  const lastTheme = Math.max(...THEME_IDS.map((id) => css.indexOf(`:root[data-theme="${id}"] {`)));
  for (const id of DISPLAY_FONT_IDS) {
    const at = css.indexOf(`:root[data-font-display="${id}"] {\n  --font-display: ${fontStack(id)};\n}`);
    assert.ok(at > lastTheme, `display ${id}`);
  }
  for (const id of TEXT_FONT_IDS) {
    const at = css.indexOf(`:root[data-font-text="${id}"] {\n  --font-text: ${fontStack(id)};\n}`);
    assert.ok(at > lastTheme, `text ${id}`);
  }
  assert.ok(!css.includes(`[data-font-text="vt323"]`));
});
