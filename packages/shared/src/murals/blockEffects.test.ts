import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveBlockStyle } from "../library/libraryStyle.js";
import { themes } from "../themes/palettes.js";
import { blockEffects } from "./blockEffects.js";

const palette = themes.light.colors;

test("legacy blocks retain transparent fade and receive shadow defaults", () => {
  const effects = blockEffects(resolveBlockStyle({ cardOpacity: 72 }), palette);
  assert.equal(effects.opacity, 0.72);
  assert.equal(effects.fadeColor, null);
  assert.equal(effects.fadeOpacity, 0);
  assert.equal(effects.boxShadow, "0 2px 4px rgba(0, 0, 0, 0.12)");
});

test("shadow color, strength, softness and distance affect both normal and hover shadows", () => {
  const effects = blockEffects(resolveBlockStyle({ shadowColor: "#ABC", shadowOpacity: 30, shadowBlur: 8, shadowOffsetY: 4 }), palette);
  assert.equal(effects.boxShadow, "0 4px 8px rgba(170, 187, 204, 0.3)");
  assert.equal(effects.hoverShadow, "0 8px 16px rgba(170, 187, 204, 0.6)");
  assert.equal(blockEffects(resolveBlockStyle({ shadowOpacity: 90 }), palette).hoverShadow, "0 4px 8px rgba(0, 0, 0, 1)");
  for (const style of [{ cardShadow: false }, { backgroundColor: "transparent" }]) {
    assert.equal(blockEffects(resolveBlockStyle(style), palette).boxShadow, "none");
  }
});

test("theme colors resolve against the mural palette for both effects", () => {
  for (const theme of [themes.light, themes.dark]) {
    const effects = blockEffects(resolveBlockStyle({ shadowColor: "theme:accent", fadeColor: "theme:background", cardOpacity: 40 }), theme.colors);
    assert.equal(effects.fadeColor, theme.colors.background);
    assert.equal(effects.opacity, 1);
    assert.equal(effects.fadeOpacity, 0.6);
    assert.notEqual(effects.boxShadow, "0 2px 4px rgba(0, 0, 0, 0.12)");
  }
});

test("colored fade washes the content without also making the block transparent", () => {
  const effects = blockEffects(resolveBlockStyle({ fadeColor: "#ffffff", cardOpacity: 72 }), palette);
  assert.equal(effects.opacity, 1);
  assert.ok(Math.abs(effects.fadeOpacity - 0.28) < 0.00001);
  assert.equal(blockEffects(resolveBlockStyle({ fadeColor: "#ffffff", cardOpacity: 100 }), palette).fadeOpacity, 0);
});

test("invalid stored effects fall back safely and numeric values stay bounded", () => {
  const style = resolveBlockStyle({ shadowOpacity: Number.NaN, shadowBlur: 100, shadowOffsetY: -5, shadowColor: 123 as never, fadeColor: {} as never });
  assert.equal(style.shadowOpacity, 12);
  assert.equal(style.shadowBlur, 24);
  assert.equal(style.shadowOffsetY, 0);
  assert.equal(style.shadowColor, null);
  assert.equal(style.fadeColor, null);
  const effects = blockEffects(resolveBlockStyle({ shadowColor: "invalid", fadeColor: "theme:unknown", cardOpacity: 72 }), palette);
  assert.equal(effects.boxShadow, "0 2px 4px rgba(0, 0, 0, 0.12)");
  assert.equal(effects.opacity, 0.72);
  assert.equal(effects.fadeColor, null);
});
