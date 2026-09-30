import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { DISPLAY_FONT_IDS, FONT_IDS, TEXT_FONT_IDS, THEME_DECOR, THEME_IDS, fontFileName, fontStack, fonts, themes } from "@scripta/shared/themes";
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

test("decor rules exist for exactly the decor themes, after every theme block, on a layer that takes no clicks", () => {
  const css = renderThemesCss();
  const lastTheme = Math.max(...THEME_IDS.map((id) => css.indexOf(`:root[data-theme="${id}"] {`)));
  for (const id of THEME_IDS) {
    const at = css.indexOf(`:root[data-theme="${id}"] body::before {`);
    assert.equal(at !== -1, THEME_DECOR[id] !== undefined, id);
    if (at === -1) continue;
    assert.ok(at > lastTheme, id);
    const rule = css.slice(at, css.indexOf("\n}\n", at));
    assert.match(rule, /position: fixed;/, id);
    assert.match(rule, /pointer-events: none;/, id);
    assert.match(rule, /z-index: -1;/, id);
    assert.equal((rule.match(/url\("data:image\/svg\+xml,/g) ?? []).length, THEME_DECOR[id]!.pieces.length, id);
  }
});

test("decor data URIs are fully percent-encoded, so a hex colour's # can't end the URL", () => {
  const css = renderThemesCss();
  const urls = [...css.matchAll(/url\("data:image\/svg\+xml,([^"]*)"\)/g)].map(([, data]) => data!);
  assert.ok(urls.length > 0);
  for (const data of urls) {
    assert.ok(!/[#<>"{}\s]/.test(data), data.slice(0, 80));
  }
});

test("full-width pieces span the viewport and corner pieces keep their pixel size", () => {
  const css = renderThemesCss();
  const synthwave = css.slice(css.indexOf(`:root[data-theme="synthwave"] body::before {`));
  assert.match(synthwave, /center bottom \/ 100% 48px no-repeat/);
  assert.match(synthwave, /right bottom \/ 120px 104px no-repeat/);
});

test("the oxblood frame is a click-through fixed border with an inset outline", () => {
  const css = renderThemesCss();
  const frame = css.split(`:root[data-theme="oxblood"] body::after {`)[1]?.split("}")[0] ?? "";
  assert.match(frame, /inset: 10px;/);
  assert.match(frame, /pointer-events: none;/);
  assert.match(frame, /border: 1\.5px solid rgba\(217, 179, 107, 0\.2\);/);
  assert.match(frame, /outline: 0\.75px solid rgba\(217, 179, 107, 0\.14\);/);
  assert.match(frame, /outline-offset: -7px;/);
  assert.ok(!css.includes(`[data-theme="matrix"] body::after`));
});
