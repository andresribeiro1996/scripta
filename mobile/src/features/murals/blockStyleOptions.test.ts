/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import { BLOCK_FONT_SIZE_RANGE, CARD_BORDER_OPACITY_RANGE, CARD_OPACITY_RANGE, CARD_RADIUS_RANGE, DEFAULT_BLOCK_STYLE, type BlockStyle } from "@scripta/shared";
import { THEME_IDS, themes } from "@scripta/shared/themes";
import { BORDER_STRENGTH_PRESETS, CORNER_PRESETS, FADE_PRESETS, QUICK_LOOKS, SIZE_PRESETS, applyLook, isHardToRead, matchPreset, matchSides, selectionBorderColor } from "./blockStyleOptions.js";

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

test("a look leaves size, alignment, spacing and fade alone", () => {
  const before: BlockStyle = { ...DEFAULT_BLOCK_STYLE, fontSize: 20, textAlign: "center", innerSpacing: "roomy", cardOpacity: 72, cardHoverEffect: true };
  for (const look of QUICK_LOOKS) {
    const after = applyLook(before, look);
    assert.equal(after.fontSize, 20, look.key);
    assert.equal(after.textAlign, "center", look.key);
    assert.equal(after.innerSpacing, "roomy", look.key);
    assert.equal(after.cardOpacity, 72, look.key);
    assert.equal(after.cardHoverEffect, true, look.key);
  }
});

test("a look resets web-only border settings to plain ones", () => {
  const web: BlockStyle = { ...DEFAULT_BLOCK_STYLE, cardBorderStyle: "groove", cardBorderOpacity: 60, cardBorderSides: { top: true, right: false, bottom: false, left: false } };
  const after = applyLook(web, QUICK_LOOKS.find((look) => look.key === "plain")!);
  assert.equal(after.cardBorderStyle, "solid");
  assert.equal(after.cardBorderOpacity, 100);
  assert.equal(matchSides(after.cardBorderSides), "all");
});

test("every theme look is readable in every theme", () => {
  for (const look of QUICK_LOOKS.filter((item) => item.group === "theme")) {
    for (const id of THEME_IDS) assert.equal(isHardToRead(applyLook(DEFAULT_BLOCK_STYLE, look), themes[id].colors), false, `${look.key} in ${id}`);
  }
});

test("every fixed look is readable, whatever the theme", () => {
  for (const look of QUICK_LOOKS.filter((item) => item.group === "fixed")) {
    for (const id of THEME_IDS) assert.equal(isHardToRead(applyLook(DEFAULT_BLOCK_STYLE, look), themes[id].colors), false, `${look.key} in ${id}`);
  }
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
