/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { BLOCK_FONT_SIZE_RANGE, CARD_BORDER_OPACITY_RANGE, CARD_OPACITY_RANGE, CARD_RADIUS_RANGE, DEFAULT_BLOCK_STYLE, blockTextColors, contrastRatio, type BlockStyle } from "@scripta/shared";
import { THEME_IDS, themes } from "@scripta/shared/themes";
import { BORDER_STRENGTH_PRESETS, COLOR_LOOKS, COLOR_LOOK_FIELDS, CORNER_PRESETS, FADE_PRESETS, FRAME_LOOKS, FRAME_LOOK_FIELDS, SIZE_PRESETS, applyLook, customColorStart, isHardToRead, matchPreset, matchSides, selectionBorderColor } from "./blockStyleOptions.js";

const onGrid = (value: number, range: { min: number; max: number; step: number }) => value >= range.min && value <= range.max && (value - range.min) % range.step === 0;

test("a value authored on web between presets highlights no preset", () => {
  assert.equal(matchPreset(CORNER_PRESETS, 8), null);
  assert.equal(matchPreset(CORNER_PRESETS, 12), "rounded");
  assert.equal(matchPreset(BORDER_STRENGTH_PRESETS, 60), null);
  assert.equal(matchSides({ top: true, right: false, bottom: false, left: true }), null);
  assert.equal(matchSides({ top: true, right: false, bottom: true, left: false }), "topBottom");
});

test("every preset sits on the grid the web sliders use", () => {
  for (const preset of CORNER_PRESETS) assert.ok(onGrid(preset.value, CARD_RADIUS_RANGE), preset.key);
  for (const preset of SIZE_PRESETS) assert.ok(onGrid(preset.value, BLOCK_FONT_SIZE_RANGE), preset.key);
  for (const preset of BORDER_STRENGTH_PRESETS) assert.ok(onGrid(preset.value, CARD_BORDER_OPACITY_RANGE), preset.key);
  for (const preset of FADE_PRESETS) assert.ok(onGrid(preset.value, CARD_OPACITY_RANGE), preset.key);
});

const sorted = (values: readonly string[]) => [...values].sort();
const both: BlockStyle = {
  ...DEFAULT_BLOCK_STYLE,
  backgroundColor: "#123456",
  textColor: "#fedcba",
  cardBorderColor: "#abcdef",
  cardRadius: 24,
  cardBorderWidth: 3,
  cardBorderStyle: "dashed",
  cardBorderOpacity: 40,
  cardBorderSides: { top: true, right: false, bottom: true, left: false },
  cardShadow: false,
};

test("colour looks and frame looks never share a field", () => {
  for (const field of COLOR_LOOK_FIELDS) assert.ok(!(FRAME_LOOK_FIELDS as readonly string[]).includes(field), field);
});

test("every colour look sets the colour fields, and only clear also sets the shadow", () => {
  for (const look of COLOR_LOOKS) assert.deepEqual(sorted(Object.keys(look.style)), sorted(look.key === "clear" ? [...COLOR_LOOK_FIELDS, "cardShadow"] : COLOR_LOOK_FIELDS), look.key);
});

test("every frame look sets exactly the frame fields", () => {
  for (const look of FRAME_LOOKS) assert.deepEqual(sorted(Object.keys(look.style)), sorted(FRAME_LOOK_FIELDS), look.key);
});

test("a colour look keeps the frame and a frame look keeps the colours", () => {
  for (const look of COLOR_LOOKS) {
    const after = applyLook(both, look);
    for (const field of FRAME_LOOK_FIELDS) if (!(look.key === "clear" && field === "cardShadow")) assert.deepEqual(after[field], both[field], `${look.key} ${field}`);
  }
  for (const look of FRAME_LOOKS) {
    const after = applyLook(both, look);
    for (const field of COLOR_LOOK_FIELDS) assert.deepEqual(after[field], both[field], `${look.key} ${field}`);
  }
});

test("a look leaves font, emphasis, size, alignment, spacing, fade and finish alone", () => {
  const before: BlockStyle = { ...DEFAULT_BLOCK_STYLE, fontFamily: "mono", bold: true, italic: true, codeStyle: true, fontSize: 20, textAlign: "center", innerSpacing: "roomy", cardOpacity: 72, cardHoverEffect: true, backgroundFinish: "linen" };
  for (const look of [...COLOR_LOOKS, ...FRAME_LOOKS]) {
    const after = applyLook(before, look);
    assert.equal(after.fontFamily, "mono", look.key);
    assert.equal(after.bold, true, look.key);
    assert.equal(after.italic, true, look.key);
    assert.equal(after.codeStyle, true, look.key);
    assert.equal(after.fontSize, 20, look.key);
    assert.equal(after.textAlign, "center", look.key);
    assert.equal(after.innerSpacing, "roomy", look.key);
    assert.equal(after.cardOpacity, 72, look.key);
    assert.equal(after.cardHoverEffect, true, look.key);
    assert.equal(after.backgroundFinish, "linen", look.key);
  }
});

test("a frame look resets web-only border settings to plain ones", () => {
  const web: BlockStyle = { ...DEFAULT_BLOCK_STYLE, cardBorderStyle: "groove", cardBorderOpacity: 60, cardBorderSides: { top: true, right: false, bottom: false, left: false } };
  const after = applyLook(web, FRAME_LOOKS.find((look) => look.key === "framed")!);
  assert.equal(after.cardBorderStyle, "solid");
  assert.equal(after.cardBorderOpacity, 100);
  assert.equal(matchSides(after.cardBorderSides), "all");
});

test("every colour look is readable in every theme", () => {
  for (const look of COLOR_LOOKS) {
    for (const id of THEME_IDS) assert.equal(isHardToRead(applyLook(DEFAULT_BLOCK_STYLE, look), themes[id].colors), false, `${look.key} in ${id}`);
  }
});

test("the palette looks keep text and muted text at 4.5:1 in every theme", () => {
  for (const key of ["sage", "seaGlass", "lilac", "rose", "ochre"]) {
    const style = applyLook(DEFAULT_BLOCK_STYLE, COLOR_LOOKS.find((look) => look.key === key)!);
    for (const id of THEME_IDS) {
      const { text, dim } = blockTextColors(style, themes[id].colors);
      assert.ok((contrastRatio(text, style.backgroundColor!) ?? 0) >= 4.5, `${key} text in ${id}`);
      assert.ok((contrastRatio(dim, style.backgroundColor!) ?? 0) >= 4.5, `${key} dim in ${id}`);
    }
  }
});

test("Margin note draws the left edge only and Bookplate's corners match a preset", () => {
  assert.equal(matchSides(FRAME_LOOKS.find((look) => look.key === "marginNote")!.style.cardBorderSides), "left");
  assert.equal(matchPreset(CORNER_PRESETS, 4), "slight");
});

test("isHardToRead flags low contrast and measures a transparent block against the page", () => {
  assert.equal(isHardToRead({ backgroundColor: "#ffffff", textColor: "#eeeeee" }, themes.light.colors), true);
  assert.equal(isHardToRead({ backgroundColor: "transparent", textColor: themes.dark.colors.background }, themes.dark.colors), true);
  assert.equal(isHardToRead({ backgroundColor: null, textColor: null }, themes.light.colors), false);
});

test("the selection border stays visible when the block itself is painted with the accent", () => {
  const light = themes.light.colors;
  const dark = themes.dark.colors;
  assert.equal(selectionBorderColor({ backgroundColor: null, cardBorderColor: null }, light), light.accent);
  assert.equal(selectionBorderColor({ backgroundColor: "#ffffff", cardBorderColor: "#123456" }, light), light.accent);
  assert.equal(selectionBorderColor({ backgroundColor: "theme:accent", cardBorderColor: null }, dark), dark.text);
  assert.equal(selectionBorderColor({ backgroundColor: light.accent.toUpperCase(), cardBorderColor: null }, light), light.text);
  assert.equal(selectionBorderColor({ backgroundColor: null, cardBorderColor: "theme:accent" }, dark), dark.text);
});

const palette = themes.light.colors;
const pick = (backgroundColor: string | null, textColor: string | null, cardBorderColor: string | null) => ({ backgroundColor, textColor, cardBorderColor });

test("customColorStart resolves theme references against the mural palette", () => {
  const style = pick("theme:accentSoft", "theme:onAccent", "theme:text");
  assert.equal(customColorStart("backgroundColor", style, palette), palette.accentSoft.toLowerCase());
  assert.equal(customColorStart("textColor", style, palette), palette.onAccent.toLowerCase());
  assert.equal(customColorStart("cardBorderColor", style, palette), palette.text.toLowerCase());
});

test("customColorStart starts unset colours from what the canvas draws", () => {
  const style = pick(null, null, null);
  assert.equal(customColorStart("backgroundColor", style, palette), palette.surface.toLowerCase());
  assert.equal(customColorStart("textColor", style, palette), palette.text.toLowerCase());
  assert.equal(customColorStart("cardBorderColor", style, palette), palette.border.toLowerCase());
});

test("customColorStart starts a transparent background from the page colour, and text from the block background", () => {
  assert.equal(customColorStart("backgroundColor", pick("transparent", null, null), palette), palette.background.toLowerCase());
  assert.equal(customColorStart("textColor", pick("transparent", "theme:accent", null), palette), palette.accent.toLowerCase());
});

test("customColorStart normalises a stored HEX and never touches the style", () => {
  const style = pick("#ABC", "#1A2B3C", "#97532d");
  const before = structuredClone(style);
  assert.equal(customColorStart("backgroundColor", style, palette), "#aabbcc");
  assert.equal(customColorStart("textColor", style, palette), "#1a2b3c");
  assert.equal(customColorStart("cardBorderColor", style, palette), "#97532d");
  assert.deepEqual(style, before);
});

test("customColorStart falls back to a valid palette colour for an unparseable stored value", () => {
  assert.equal(customColorStart("textColor", pick(null, "not-a-color", null), palette), palette.text.toLowerCase());
});

test("shadow and fade custom colors start from their rendered defaults and resolve theme references", () => {
  assert.equal(customColorStart("shadowColor", DEFAULT_BLOCK_STYLE, palette), "#000000");
  assert.equal(customColorStart("fadeColor", DEFAULT_BLOCK_STYLE, palette), palette.background);
  const style = { ...DEFAULT_BLOCK_STYLE, shadowColor: "theme:accent", fadeColor: "#ABC" };
  assert.equal(customColorStart("shadowColor", style, palette), palette.accent);
  assert.equal(customColorStart("fadeColor", style, palette), "#aabbcc");
});

test("gradient colors use the existing editor and warn if the second end hides the text", () => {
  assert.equal(customColorStart("gradientColor", DEFAULT_BLOCK_STYLE, palette), palette.accent);
  assert.equal(customColorStart("gradientColor", { ...DEFAULT_BLOCK_STYLE, gradientColor: "theme:accentSoft" }, palette), palette.accentSoft);
  assert.equal(isHardToRead({ ...DEFAULT_BLOCK_STYLE, backgroundColor: "#fff", textColor: "#000", gradientColor: "#000" }, palette), true);
  assert.equal(isHardToRead({ ...DEFAULT_BLOCK_STYLE, backgroundColor: "#fff", textColor: "#000", gradientColor: "#000", gradientStrength: 25 }, palette), false);
});
