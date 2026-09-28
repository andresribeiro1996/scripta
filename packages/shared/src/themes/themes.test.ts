import assert from "node:assert/strict";
import { test } from "node:test";
import { THEME_IDS, themes, type ThemeColors } from "./palettes.js";
import { THEME_PREFERENCES, parseThemePreference, resolveTheme } from "./preference.js";

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

const AA_PAIRS: Array<[keyof ThemeColors, keyof ThemeColors]> = [
  ["text", "background"],
  ["text", "surface"],
  ["textDim", "surface"],
  ["textDim", "background"],
  ["accent", "surface"],
  ["onAccent", "accent"],
  ["onDanger", "danger"],
  ["danger", "surface"],
  ["success", "surface"],
  ["info", "surface"],
  ["reference", "surface"],
  ["accent", "accentSoft"],
  ["danger", "dangerSoft"],
  ["success", "successSoft"],
  ["info", "infoSoft"],
  ["reference", "referenceSoft"],
  ["text", "accentFill"],
];

for (const id of THEME_IDS) {
  test(`${id}: every text pairing reaches 4.5:1`, () => {
    const colors = themes[id].colors;
    for (const [fg, bg] of AA_PAIRS) {
      const ratio = contrast(colors[fg], colors[bg]);
      assert.ok(ratio >= 4.5, `${id} ${fg} on ${bg} is ${ratio.toFixed(2)}:1`);
    }
  });

  test(`${id}: accentFill separates from the page more than a border does`, () => {
    const colors = themes[id].colors;
    assert.ok(contrast(colors.accentFill, colors.background) > contrast(colors.border, colors.background));
  });

  test(`${id}: every colour except scrim is a lowercase six-digit hex`, () => {
    for (const [token, value] of Object.entries(themes[id].colors)) {
      if (token === "scrim") assert.match(value, /^rgba\(\d+, \d+, \d+, 0\.\d+\)$/, `${id}.scrim`);
      else assert.match(value, /^#[0-9a-f]{6}$/, `${id}.${token}`);
    }
  });
}

test("exactly the designed themes use the dark scheme", () => {
  assert.deepEqual(
    THEME_IDS.filter((id) => themes[id].scheme === "dark"),
    ["dark", "midnight", "forest", "matrix", "synthwave", "seventies", "oxblood"],
  );
});

test("THEME_PREFERENCES is system followed by every theme id in picker order", () => {
  assert.deepEqual(THEME_PREFERENCES, ["system", ...THEME_IDS]);
});

test("parseThemePreference keeps valid values and turns anything else into system", () => {
  for (const value of THEME_PREFERENCES) assert.equal(parseThemePreference(value), value);
  for (const value of ["vaporwave", "", "Light", " dark", null, undefined, 3, {}]) assert.equal(parseThemePreference(value), "system");
});

test("resolveTheme follows the OS only for system", () => {
  assert.equal(resolveTheme("system", "light"), "light");
  assert.equal(resolveTheme("system", "dark"), "dark");
  assert.equal(resolveTheme("matrix", "light"), "matrix");
  assert.equal(resolveTheme("sepia", "dark"), "sepia");
});
