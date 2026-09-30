import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_BLOCK_STYLE, resolveBlockStyle, type BlockStyle } from "../library/libraryStyle.js";
import { themes } from "../themes/palettes.js";
import { blockFinish, finishPatternSvg } from "./backgroundFinish.js";

const light = themes.light.colors;
const dark = themes.dark.colors;
const style = (patch: Partial<BlockStyle>): BlockStyle => ({ ...DEFAULT_BLOCK_STYLE, ...patch });

test("a legacy block with no finish resolves to plain", () => {
  const { backgroundFinish: _omitted, ...legacy } = DEFAULT_BLOCK_STYLE;
  assert.equal(resolveBlockStyle(legacy).backgroundFinish, "none");
  assert.equal(resolveBlockStyle(undefined).backgroundFinish, "none");
});

test("an unsupported finish resolves to plain and a supported one is kept", () => {
  assert.equal(resolveBlockStyle({ backgroundFinish: "velvet" as never }).backgroundFinish, "none");
  assert.equal(resolveBlockStyle({ backgroundFinish: null as never }).backgroundFinish, "none");
  assert.equal(resolveBlockStyle({ backgroundFinish: "linen" }).backgroundFinish, "linen");
});

test("plain draws no finish", () => {
  assert.equal(blockFinish(style({}), light), null);
});

test("a transparent background suppresses the finish without changing the stored value", () => {
  const transparent = style({ backgroundColor: "transparent", backgroundFinish: "paper" });
  assert.equal(blockFinish(transparent, light), null);
  assert.equal(transparent.backgroundFinish, "paper");
});

test("colour and finish are independent", () => {
  assert.equal(blockFinish(style({ backgroundColor: "#a3b18a", backgroundFinish: "paper" }), light)?.finish, "paper");
  assert.equal(blockFinish(style({ backgroundColor: "theme:accent", backgroundFinish: "linen" }), light)?.finish, "linen");
});

test("ink follows the block's effective text colour", () => {
  assert.equal(blockFinish(style({ backgroundFinish: "paper" }), light)?.ink, light.text);
  assert.equal(blockFinish(style({ backgroundFinish: "paper" }), dark)?.ink, dark.text);
  assert.equal(blockFinish(style({ backgroundFinish: "linen", textColor: "#ff0000" }), light)?.ink, "#ff0000");
  assert.equal(blockFinish(style({ backgroundFinish: "linen", textColor: "theme:accent" }), light)?.ink, light.accent);
});

test("a text colour that is not hex draws no finish rather than leaking into the SVG", () => {
  assert.equal(blockFinish(style({ backgroundFinish: "paper", textColor: 'red" onload="x' }), light), null);
});

test("finish patterns are deterministic SVG documents drawn in the ink", () => {
  for (const finish of ["paper", "linen"] as const) {
    const svg = finishPatternSvg(finish, "#123456");
    assert.equal(svg, finishPatternSvg(finish, "#123456"));
    assert.ok(svg.startsWith("<svg "));
    assert.ok(svg.endsWith("</svg>"));
    assert.ok(svg.includes("#123456"));
    assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));
  }
  assert.notEqual(finishPatternSvg("paper", "#123456"), finishPatternSvg("linen", "#123456"));
});
