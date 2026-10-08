import assert from "node:assert/strict";
import { test } from "node:test";
import { composePlate, type PlateFace } from "./compose.js";

const face: PlateFace = { key: "star", emblemSvg: `<g id="emblem"/>`, name: "Stargazer", eyebrow: "THE", epithet: "lives half in other worlds", numeral: "IV", reader: "ANDRE", width: 250, label: "x" };

test("slots land in layer order", () => {
  const svg = composePlate(face, { underlay: `<g id="u"/>`, frameBand: `<g id="f"/>`, top: `<g id="t"/>`, rings: `<g id="r"/>`, seal: `<g id="s"/>`, banner: `<g id="b"/>`, trait: `<g id="tr"/>`, overlay: `<g id="o"/>` });
  const at = (needle: string) => svg.indexOf(needle);
  assert.ok(at(`id="u"`) < at(`x="10" y="10"`));
  assert.ok(at(`x="16" y="16"`) < at(`id="f"`) && at(`id="f"`) < at("EX LIBRIS"));
  assert.ok(at("EX LIBRIS") < at(`id="t"`) && at(`id="t"`) < at(`r="60"`));
  assert.ok(at(`r="55"`) < at(`id="r"`) && at(`id="r"`) < at(`id="emblem"`) && at(`id="emblem"`) < at(`id="s"`));
  assert.ok(at(`id="s"`) < at(`id="b"`) && at(`id="b"`) < at(">THE<"));
  assert.ok(at("lives half in other worlds") < at(`id="tr"`) && at(`id="tr"`) < at("M30 305H220"));
  assert.ok(at(">ANDRE<") < at(`id="o"`) && at(`id="o"`) < at("</svg>"));
});

test("a slot replaces its default, and an empty string removes it", () => {
  const svg = composePlate(face, { corners: "", header: `<text>MOTTO</text>`, footerLeft: "", footerRight: "" });
  assert.doesNotMatch(svg, /EX LIBRIS/);
  assert.doesNotMatch(svg, /PLATE IV/);
  assert.doesNotMatch(svg, />ANDRE</);
  assert.doesNotMatch(svg, /M16 11\.5/);
  assert.match(svg, /<text>MOTTO<\/text>/);
});
