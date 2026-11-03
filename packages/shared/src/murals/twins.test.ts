import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BLOCK_STYLE } from "../library/libraryStyle.js";
import { THEME_IDS, themes } from "../themes/palettes.js";
import { contrastRatio, effectiveBlockColors } from "./blockTextColors.js";
import { muralBlockStyle, muralColors, oppositeScheme } from "./twins.js";

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

const dark = muralColors("sepia", "dark");
const flip = (style: typeof DEFAULT_BLOCK_STYLE) => muralBlockStyle(style, "sepia", "dark");

test("a block in its theme's own scheme keeps its style object", () => {
  const style = { ...DEFAULT_BLOCK_STYLE, backgroundColor: "#fff3b0" };
  assert.strictEqual(muralBlockStyle(style, "sepia", "light"), style);
});

test("non-hex colours and the shadow colour pass through", () => {
  const style = { ...DEFAULT_BLOCK_STYLE, backgroundColor: "transparent", textColor: "theme:accent", cardBorderColor: "rgba(0, 0, 0, 0.5)", fadeColor: "red", gradientColor: null, shadowColor: "#000000" };
  assert.deepEqual(flip(style), style);
});

test("the light surface lands on the dark surface", () => {
  const out = flip({ ...DEFAULT_BLOCK_STYLE, backgroundColor: themes.light.colors.surface });
  assert.ok(contrastRatio(out.backgroundColor!, themes.dark.colors.surface)! < 1.1);
});

test("a light block stays apart from the twin's page", () => {
  const out = flip({ ...DEFAULT_BLOCK_STYLE, backgroundColor: "#fff3b0" });
  assert.ok(contrastRatio(out.backgroundColor!, dark.background)! > 1.3);
});

test("short and uppercase hex flips to lowercase six-digit hex", () => {
  const out = flip({ ...DEFAULT_BLOCK_STYLE, backgroundColor: "#FFF", gradientColor: "#FFF3B0" });
  assert.match(out.backgroundColor!, /^#[0-9a-f]{6}$/);
  assert.match(out.gradientColor!, /^#[0-9a-f]{6}$/);
  assert.ok(contrastRatio(out.backgroundColor!, themes.dark.colors.surface)! < 1.2);
});

test("flipped blocks keep readable text", () => {
  for (const [backgroundColor, textColor] of [["#fff3b0", null], ["#fff3b0", "#8a8a8a"], ["#777777", null], ["#201e1c", null]] as const) {
    const out = flip({ ...DEFAULT_BLOCK_STYLE, backgroundColor, textColor });
    const { text, background } = effectiveBlockColors(out, dark);
    assert.ok(contrastRatio(text, background)! >= 4.5, `${backgroundColor} ${textColor}`);
  }
});

test("text that needs no nudge stays unset", () => {
  assert.equal(flip({ ...DEFAULT_BLOCK_STYLE, backgroundColor: "#ffffff", textColor: null }).textColor, null);
});

test("the stored style is never mutated", () => {
  const style = { ...DEFAULT_BLOCK_STYLE, backgroundColor: "#fff3b0", textColor: "#8a8a8a" };
  const copy = structuredClone(style);
  flip(style);
  assert.deepEqual(style, copy);
});
