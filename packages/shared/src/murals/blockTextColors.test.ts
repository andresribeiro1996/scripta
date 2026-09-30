import assert from "node:assert/strict";
import { test } from "node:test";
import { blockTextColors, contrastRatio, mutedTextColor, normalizeHexColor, parseHexColor, parseThemeColorRef, resolveBlockColor, themeColorRef, toHex } from "./blockTextColors.js";
import { themes } from "../themes/palettes.js";

const light = themes.light.colors;
const dark = themes.dark.colors;

const starterBackground = "#2b2622";
const starterText = "#f5f1e9";

test("mutedTextColor mutes light text on a dark card while staying readable", () => {
  const dim = mutedTextColor(starterText, starterBackground);
  assert.ok(dim);
  assert.ok(contrastRatio(dim!, starterBackground)! >= 4.5);
  assert.notEqual(dim, starterText);
});

test("mutedTextColor mutes dark text on a light background while staying readable", () => {
  const dim = mutedTextColor("#1a1a1a", "#f5f1e9");
  assert.ok(dim);
  assert.ok(contrastRatio(dim!, "#f5f1e9")! >= 4.5);
  assert.notEqual(dim, "#1a1a1a");
});

test("mutedTextColor falls back to black or white when the text itself fails contrast", () => {
  const dim = mutedTextColor("#777777", "#808080");
  assert.ok(dim);
  assert.ok(contrastRatio(dim!, "#808080")! >= 4.5);
});

test("mutedTextColor picks whichever of black/white passes on a mid-grey background", () => {
  const dim = mutedTextColor("#777777", "#777777");
  assert.ok(dim);
  assert.ok(contrastRatio(dim!, "#777777")! >= 4.5);
});

test("mutedTextColor parses #rgb shorthand and uppercase hex", () => {
  assert.equal(mutedTextColor("#FFF", "#000"), mutedTextColor("#ffffff", "#000000"));
  assert.ok(mutedTextColor("#FFF", "#000"));
});

test("mutedTextColor returns null for unparseable colours", () => {
  assert.equal(mutedTextColor("red", "#000000"), null);
  assert.equal(mutedTextColor("", "#000000"), null);
  assert.equal(mutedTextColor("rgba(0,0,0,.5)", "#000000"), null);
  assert.equal(mutedTextColor("#ffffff", "red"), null);
});

test("blockTextColors keeps the theme's colours when the block has no overrides", () => {
  const theme = { ...light, text: "#111111", textDim: "#666666", surface: "#eeeeee" };
  assert.deepEqual(blockTextColors({ backgroundColor: null, textColor: null }, theme), { text: theme.text, dim: theme.textDim, accent: theme.accent });
});

test("blockTextColors mutes against the theme surface when only textColor is overridden", () => {
  const theme = { ...light, text: "#111111", textDim: "#666666", surface: "#0a0a0a" };
  const { text, dim } = blockTextColors({ backgroundColor: null, textColor: starterText }, theme);
  assert.equal(text, starterText);
  assert.ok(contrastRatio(dim, theme.surface)! >= 4.5);
});

test("blockTextColors mutes against the block background when only backgroundColor is overridden", () => {
  const theme = { ...light, text: "#eeeeee", textDim: "#999999", surface: "#ffffff" };
  const { text, dim } = blockTextColors({ backgroundColor: starterBackground, textColor: null }, theme);
  assert.equal(text, theme.text);
  assert.ok(contrastRatio(dim, starterBackground)! >= 4.5);
});

test("blockTextColors mutes against the block's own colours when both are overridden", () => {
  const theme = { ...light, text: "#000000", textDim: "#333333", surface: "#ffffff" };
  const { text, dim } = blockTextColors({ backgroundColor: starterBackground, textColor: starterText }, theme);
  assert.equal(text, starterText);
  assert.ok(contrastRatio(dim, starterBackground)! >= 4.5);
});

test("blockTextColors falls back to theme.textDim when the override colours don't parse", () => {
  const theme = { ...light, text: "#111111", textDim: "#666666", surface: "#0a0a0a" };
  const { dim } = blockTextColors({ backgroundColor: "not-a-color", textColor: null }, theme);
  assert.equal(dim, theme.textDim);
});

const SPREAD_COLORS = [
  "#000000", "#111111", "#222222", "#2b2622", "#233d35", "#25364f", "#44252e",
  "#333333", "#444444", "#555555", "#666666", "#777777", "#808080", "#999999",
  "#aaaaaa", "#bbbbbb", "#cccccc", "#dddddd", "#e6c79c", "#edcd96", "#c2dbc9",
  "#c5d7f1", "#eeeeee", "#f5f1e9", "#ffffff"
];

test("mutedTextColor's boundary case: the rounded mix, not the unrounded one, must clear 4.5:1", () => {
  const dim = mutedTextColor("#000038", "#999999");
  assert.ok(dim);
  assert.ok(contrastRatio(dim!, "#999999")! >= 4.5, `muted to ${dim} (${contrastRatio(dim!, "#999999")}:1)`);
});

test("mutedTextColor's returned hex, not just the unrounded mix, meets 4.5:1 against the background", () => {
  for (const text of SPREAD_COLORS) {
    for (const background of SPREAD_COLORS) {
      const dim = mutedTextColor(text, background);
      assert.ok(dim, `${text} on ${background} produced no colour`);
      const actual = contrastRatio(dim!, background)!;
      assert.ok(actual >= 4.5, `${text} on ${background} muted to ${dim} (${actual.toFixed(4)}:1)`);
    }
  }
});

test("resolveBlockColor turns a theme reference into the viewer's theme colour", () => {
  assert.equal(resolveBlockColor(themeColorRef("accentSoft"), light), light.accentSoft);
  assert.equal(resolveBlockColor(themeColorRef("accentSoft"), dark), dark.accentSoft);
});

test("resolveBlockColor passes hex, transparent and null through", () => {
  assert.equal(resolveBlockColor("#123456", light), "#123456");
  assert.equal(resolveBlockColor("transparent", light), "transparent");
  assert.equal(resolveBlockColor(null, light), null);
});

test("an unknown theme key resolves to the theme default, not a colour", () => {
  assert.equal(resolveBlockColor("theme:nope", light), null);
  assert.equal(parseThemeColorRef("theme:nope"), null);
  assert.equal(parseThemeColorRef("#ffffff"), null);
  assert.equal(parseThemeColorRef(themeColorRef("onAccent")), "onAccent");
});

test("blockTextColors measures a transparent block against the page background", () => {
  const colors = blockTextColors({ backgroundColor: "transparent", textColor: null }, light);
  assert.equal(colors.text, light.text);
  assert.equal(colors.dim, mutedTextColor(light.text, light.background));
});

test("blockTextColors resolves theme references before measuring", () => {
  const colors = blockTextColors({ backgroundColor: themeColorRef("accent"), textColor: themeColorRef("onAccent") }, dark);
  assert.equal(colors.text, dark.onAccent);
  assert.ok(contrastRatio(colors.dim, dark.accent)! >= 4.5);
});

test("blockTextColors keeps the theme accent when the block has no overrides", () => {
  assert.equal(blockTextColors({ backgroundColor: null, textColor: null }, light).accent, light.accent);
});

test("blockTextColors swaps the accent for the text colour when the block is painted with the accent", () => {
  for (const theme of [light, dark]) {
    const colors = blockTextColors({ backgroundColor: themeColorRef("accent"), textColor: themeColorRef("onAccent") }, theme);
    assert.equal(colors.accent, theme.onAccent);
  }
});

test("blockTextColors swaps the accent for the text colour on a fixed background equal to the accent", () => {
  const colors = blockTextColors({ backgroundColor: light.accent, textColor: "#ffffff" }, light);
  assert.equal(colors.accent, "#ffffff");
});

test("blockTextColors keeps the theme accent where it reads against the block background", () => {
  assert.equal(blockTextColors({ backgroundColor: "#ffffff", textColor: null }, light).accent, light.accent);
});

test("normalizeHexColor expands shorthand, lowercases and trims", () => {
  assert.equal(normalizeHexColor("#abc"), "#aabbcc");
  assert.equal(normalizeHexColor("#AABBCC"), "#aabbcc");
  assert.equal(normalizeHexColor("  #1A2b3C \n"), "#1a2b3c");
});

test("normalizeHexColor rejects anything that is not #rgb or #rrggbb", () => {
  for (const input of ["abc", "#abcd", "#ggg", "#12345", "", "rgb(0,0,0)"]) assert.equal(normalizeHexColor(input), null, input);
});

test("parseHexColor and toHex round-trip", () => {
  for (const hex of ["#000000", "#ffffff", "#1a2b3c", "#97532d"]) assert.equal(toHex(parseHexColor(hex)!), hex);
  assert.deepEqual(parseHexColor("#0080ff"), { r: 0, g: 128, b: 255 });
});
