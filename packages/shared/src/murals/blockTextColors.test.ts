import assert from "node:assert/strict";
import { test } from "node:test";
import { blockTextColors, contrastRatio, mutedTextColor } from "./blockTextColors.js";
import { MURAL_PRESETS } from "./presets.js";

const starterBackground = MURAL_PRESETS.find((preset) => preset.id === "shelf")!.color;
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
  const theme = { text: "#111111", textDim: "#666666", surface: "#eeeeee" };
  assert.deepEqual(blockTextColors({ backgroundColor: null, textColor: null }, theme), { text: theme.text, dim: theme.textDim });
});

test("blockTextColors mutes against the theme surface when only textColor is overridden", () => {
  const theme = { text: "#111111", textDim: "#666666", surface: "#0a0a0a" };
  const { text, dim } = blockTextColors({ backgroundColor: null, textColor: starterText }, theme);
  assert.equal(text, starterText);
  assert.ok(contrastRatio(dim, theme.surface)! >= 4.5);
});

test("blockTextColors mutes against the block background when only backgroundColor is overridden", () => {
  const theme = { text: "#eeeeee", textDim: "#999999", surface: "#ffffff" };
  const { text, dim } = blockTextColors({ backgroundColor: starterBackground, textColor: null }, theme);
  assert.equal(text, theme.text);
  assert.ok(contrastRatio(dim, starterBackground)! >= 4.5);
});

test("blockTextColors mutes against the block's own colours when both are overridden", () => {
  const theme = { text: "#000000", textDim: "#333333", surface: "#ffffff" };
  const { text, dim } = blockTextColors({ backgroundColor: starterBackground, textColor: starterText }, theme);
  assert.equal(text, starterText);
  assert.ok(contrastRatio(dim, starterBackground)! >= 4.5);
});

test("blockTextColors falls back to theme.textDim when the override colours don't parse", () => {
  const theme = { text: "#111111", textDim: "#666666", surface: "#0a0a0a" };
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
