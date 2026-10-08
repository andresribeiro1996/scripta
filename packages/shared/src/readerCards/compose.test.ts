import assert from "node:assert/strict";
import { test } from "node:test";
import { composePage, composePlate, type PlateFace } from "./compose.js";

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

test("the ink wrapper holds everything from the frame to the footer, between the underlay and the overlay", () => {
  const svg = composePlate(face, { underlay: `<g id="u"/>`, overlay: `<g id="o"/>` }, (body) => `<g id="ink">\n${body}\n</g>`);
  const inside = svg.slice(svg.indexOf(`<g id="ink">`), svg.indexOf(`<g id="o"/>`));
  for (const part of [`x="10" y="10"`, "EX LIBRIS", `r="60"`, `id="emblem"`, ">ANDRE<"]) assert.ok(inside.includes(part), part);
  assert.ok(svg.indexOf(`id="u"`) < svg.indexOf(`id="ink"`));
  assert.doesNotMatch(inside, /id="u"|id="o"/);
});

test("without a wrapper the plate is unchanged", () => {
  const slots = { underlay: `<g id="u"/>`, top: `<g id="t"/>` };
  assert.equal(composePlate(face, slots, (body) => body), composePlate(face, slots));
});

test("a frame slot replaces both frame rules on the front and on a back page", () => {
  for (const svg of [composePlate(face, { frame: `<g id="gold"/>` }), composePage(face, "<g/>", { frame: `<g id="gold"/>` })]) {
    assert.match(svg, /<g id="gold"\/>/);
    assert.doesNotMatch(svg, /x="10" y="10"/);
  }
});
