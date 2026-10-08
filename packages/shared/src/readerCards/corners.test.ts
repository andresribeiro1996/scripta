import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { cornersSlot } from "./corners.js";
import { renderReaderCard } from "./render.js";
import { seedOf } from "./seed.js";
import { CORNER_STYLES, DEFAULT_READER_CARD_STYLE, publicStyle, type CornerStyle } from "./style.js";

const card: PublicReaderCard = { state: "settled", identity: "star", runnerUp: null, streak: "lamp", signal: null, coverage: [], dial: { segments: [{ group: "star", books: 8, marked: 2 }] }, facts: { finished: 8, highlights: 2, series: 0, since: 2014, edition: 2026 } };
const render = (corners: CornerStyle, page: "front" | "record" = "front") => renderReaderCard({ card, style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), corners }, readerName: "andre", print: "paper", label: "x", seed: seedOf("andre") }, page);

test("diamonds draw today's corners and none draws no corners", () => {
  assert.equal(cornersSlot("diamonds"), undefined);
  assert.equal(cornersSlot("none"), "");
  assert.match(render("diamonds"), /M16 11\.5L20\.5 16L16 20\.5L11\.5 16Z/);
  assert.doesNotMatch(render("none"), /M16 11\.5/);
});

test("every ornament draws in all four corners, mirrored", () => {
  for (const corners of CORNER_STYLES.filter((key) => key !== "diamonds" && key !== "none")) {
    const svg = cornersSlot(corners)!;
    assert.ok(svg.length > 0, corners);
    assert.doesNotMatch(svg, /NaN|undefined/, corners);
  }
  assert.match(cornersSlot("deco")!, /M22 38V22H38M26 32V26H32.*M228 38V22H212M224 32V26H218.*M22 312V328H38.*M228 312V328H212/s);
  assert.match(cornersSlot("photo")!, /M10 10L38 10L10 38Z.*M240 10L212 10L240 38Z.*M10 340L38 340L10 312Z.*M240 340L212 340L240 312Z/s);
  assert.match(cornersSlot("register")!, /M8 16H24M16 8V24.*M226 16H242M234 8V24.*M8 334H24M16 326V342.*M226 334H242M234 326V342/s);
  assert.match(cornersSlot("laurel")!, /M46 19Q21 21 19 46.*M204 19Q229 21 231 46/s);
  assert.equal(cornersSlot("rosette")!.match(/<ellipse /g)?.length, 32);
});

test("a chosen ornament replaces the diamonds on the front and on the back pages", () => {
  for (const page of ["front", "record"] as const) {
    const svg = render("laurel", page);
    assert.doesNotMatch(svg, /M16 11\.5/, page);
    assert.match(svg, /M46 19Q21 21 19 46/, page);
  }
});
