import assert from "node:assert/strict";
import { test } from "node:test";
import { THEME_IDS, themes } from "../themes/palettes.js";
import { muralColors, oppositeScheme } from "./twins.js";

test("a theme in its own scheme is its own palette", () => {
  for (const id of THEME_IDS) assert.strictEqual(muralColors(id, themes[id].scheme), themes[id].colors);
});

test("Light and Dark are each other's twins", () => {
  assert.strictEqual(muralColors("light", "dark"), themes.dark.colors);
  assert.strictEqual(muralColors("dark", "light"), themes.light.colors);
});

test("Newsprint's dark twin inks with its paper colour", () => {
  assert.equal(muralColors("newsprint", "dark").accent, "#ece9e1");
});

test("a twin takes the target base theme's scrim", () => {
  for (const id of THEME_IDS) {
    const to = oppositeScheme(themes[id].scheme);
    assert.equal(muralColors(id, to).scrim, themes[to].colors.scrim);
  }
});

test("twins are computed once", () => {
  assert.strictEqual(muralColors("sepia", "dark"), muralColors("sepia", "dark"));
});

test("oppositeScheme swaps light and dark", () => {
  assert.equal(oppositeScheme("light"), "dark");
  assert.equal(oppositeScheme("dark"), "light");
});
