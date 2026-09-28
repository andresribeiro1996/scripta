import assert from "node:assert/strict";
import { test } from "node:test";
import { DISPLAY_FONT_IDS, FONT_IDS, TEXT_FONT_IDS, fontFileName, fontStack, fonts, type FontId } from "./fonts.js";
import { THEME_IDS, themes } from "./palettes.js";
import {
  DISPLAY_FONT_PREFERENCES,
  TEXT_FONT_PREFERENCES,
  parseAccountAppearance,
  parseFontPreference,
  reconcileAppearance,
  resolveFonts,
  type FontPreference,
} from "./preference.js";

test("the catalog lists every font once and FONT_IDS matches its keys", () => {
  assert.deepEqual([...FONT_IDS].sort(), Object.keys(fonts).sort());
  assert.equal(new Set(FONT_IDS).size, FONT_IDS.length);
});

test("picker lists are in the designed order and only hold fonts allowed in that slot", () => {
  assert.deepEqual(DISPLAY_FONT_IDS, ["system", "playfair", "literata", "fraunces", "cormorant", "specialElite", "vt323", "orbitron", "righteous", "pressStart", "monoton"]);
  assert.deepEqual(TEXT_FONT_IDS, ["system", "literata", "atkinson", "jetbrainsMono"]);
  for (const id of DISPLAY_FONT_IDS) assert.ok(fonts[id].slots.includes("display"), id);
  for (const id of TEXT_FONT_IDS) assert.ok(fonts[id].slots.includes("text"), id);
});

test("system has no files; every other font has a family, and display-only fonts ship exactly one weight", () => {
  assert.equal(fonts.system.family, null);
  assert.deepEqual(fonts.system.weights, []);
  for (const id of FONT_IDS.filter((font) => font !== "system")) {
    assert.ok(fonts[id].family, id);
    assert.ok(fonts[id].weights.length >= 1, id);
    if (!fonts[id].slots.includes("text")) assert.equal(fonts[id].weights.length, 1, id);
  }
});

test("every theme's default fonts exist and are allowed in their slot", () => {
  const expected: Record<string, [FontId, FontId]> = {
    light: ["playfair", "system"], dark: ["playfair", "system"], midnight: ["playfair", "system"],
    sepia: ["literata", "literata"], rose: ["fraunces", "system"], forest: ["fraunces", "system"],
    matrix: ["vt323", "jetbrainsMono"], synthwave: ["orbitron", "system"], seventies: ["righteous", "system"],
    newsprint: ["specialElite", "literata"], oxblood: ["cormorant", "literata"],
  };
  for (const id of THEME_IDS) {
    assert.deepEqual([themes[id].fonts.display, themes[id].fonts.text], expected[id], id);
    assert.ok(fonts[themes[id].fonts.display].slots.includes("display"), id);
    assert.ok(fonts[themes[id].fonts.text].slots.includes("text"), id);
  }
});

test("Press Start 2P and Monoton are override-only", () => {
  for (const id of THEME_IDS) {
    assert.notEqual(themes[id].fonts.display, "pressStart");
    assert.notEqual(themes[id].fonts.display, "monoton");
  }
});

test("fontStack puts the quoted family first; fontFileName joins id and weight", () => {
  assert.equal(fontStack("playfair"), '"Playfair Display", ui-serif, Georgia, serif');
  assert.equal(fontStack("system"), '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif');
  assert.equal(fontFileName("jetbrainsMono", 700), "jetbrainsMono-700");
});

test("parseFontPreference keeps allowed values per slot and turns anything else into theme", () => {
  for (const value of DISPLAY_FONT_PREFERENCES) assert.equal(parseFontPreference("display", value), value);
  for (const value of TEXT_FONT_PREFERENCES) assert.equal(parseFontPreference("text", value), value);
  assert.equal(parseFontPreference("text", "vt323"), "theme");
  assert.equal(parseFontPreference("display", "atkinson"), "theme");
  for (const value of ["comic", "", null, undefined, 7, {}]) assert.equal(parseFontPreference("display", value), "theme");
});

test("parseAccountAppearance keeps null as never-chosen and normalises unknown values", () => {
  assert.deepEqual(parseAccountAppearance({ theme: null, displayFont: null, textFont: null }), { theme: null, displayFont: null, textFont: null });
  assert.deepEqual(parseAccountAppearance({}), { theme: null, displayFont: null, textFont: null });
  assert.deepEqual(parseAccountAppearance(null), { theme: null, displayFont: null, textFont: null });
  assert.deepEqual(parseAccountAppearance({ theme: "vaporwave", displayFont: "comic", textFont: "vt323" }), { theme: "system", displayFont: "theme", textFont: "theme" });
  assert.deepEqual(parseAccountAppearance({ theme: "matrix", displayFont: "monoton", textFont: "atkinson" }), { theme: "matrix", displayFont: "monoton", textFont: "atkinson" });
});

test("resolveFonts uses the theme default for theme, keeps an allowed override, and ignores an ineligible one", () => {
  assert.deepEqual(resolveFonts("matrix", "theme", "theme"), { display: "vt323", text: "jetbrainsMono" });
  assert.deepEqual(resolveFonts("sepia", "pressStart", "atkinson"), { display: "pressStart", text: "atkinson" });
  assert.deepEqual(resolveFonts("light", "theme", "vt323" as FontPreference), { display: "playfair", text: "system" });
  assert.deepEqual(resolveFonts("oxblood", "atkinson" as FontPreference, "theme"), { display: "cormorant", text: "literata" });
});

test("reconcileAppearance applies the rule per field", () => {
  const device = { theme: "sepia", displayFont: "theme", textFont: "atkinson" } as const;
  assert.deepEqual(reconcileAppearance({ theme: null, displayFont: null, textFont: null }, device), { apply: {}, upload: device });
  assert.deepEqual(reconcileAppearance({ theme: "sepia", displayFont: "theme", textFont: "atkinson" }, device), { apply: {}, upload: {} });
  assert.deepEqual(reconcileAppearance({ theme: "matrix", displayFont: null, textFont: "atkinson" }, device), { apply: { theme: "matrix" }, upload: { displayFont: "theme" } });
});
