import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveBlockStyle } from "../library/libraryStyle.js";
import { themes } from "../themes/palettes.js";
import { blockGradient } from "./blockGradient.js";

const palette = themes.light.colors;

test("legacy, transparent and invalid colors draw no gradient", () => {
  for (const patch of [{}, { backgroundColor: "transparent", gradientColor: "#abc" }, { gradientColor: "invalid" }, { gradientColor: "theme:unknown" }]) assert.equal(blockGradient(resolveBlockStyle(patch), palette), null);
});

test("direction and blend strength work with both hex and theme colors", () => {
  const gradient = blockGradient(resolveBlockStyle({ backgroundColor: "#000", gradientColor: "#fff", gradientAngle: 90, gradientStrength: 50 }), palette);
  assert.deepEqual(gradient, { image: "linear-gradient(90deg, #000000, rgba(255, 255, 255, 0.5))", endColor: "#808080" });
  for (const theme of [themes.light, themes.dark]) {
    const themed = blockGradient(resolveBlockStyle({ backgroundColor: "theme:surface", gradientColor: "theme:accent" }), theme.colors);
    assert.equal(themed?.endColor, theme.colors.accent);
    assert.ok(themed?.image.includes(theme.colors.surface));
  }
});

test("stored angles and strength stay bounded and missing settings use defaults", () => {
  const style = resolveBlockStyle({ gradientColor: "#fff", gradientAngle: Infinity, gradientStrength: -10 });
  assert.equal(style.gradientAngle, 135);
  assert.equal(style.gradientStrength, 0);
  assert.equal(blockGradient(style, palette)?.endColor, palette.surface);
  assert.equal(resolveBlockStyle({ gradientAngle: 500, gradientStrength: 101 }).gradientAngle, 360);
  assert.equal(resolveBlockStyle({ gradientStrength: 101 }).gradientStrength, 100);
  assert.equal(resolveBlockStyle({ gradientColor: 123 as never }).gradientColor, null);
});
