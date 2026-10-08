import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { EX_LIBRIS } from "./compose.js";
import { LIFTED_EX_LIBRIS, mottoSlots } from "./mottos.js";
import { renderReaderCard } from "./render.js";
import { seedOf } from "./seed.js";
import { DEFAULT_READER_CARD_STYLE, MOTTO_LOOKS, publicStyle, type MottoLook } from "./style.js";

const WORDS = "Per libros ad astra";
const card: PublicReaderCard = { state: "settled", identity: "star", runnerUp: null, streak: "lamp", signal: null, coverage: [], dial: { segments: [{ group: "star", books: 8, marked: 2 }] }, facts: { finished: 8, highlights: 2, series: 0, since: 2014, edition: 2026 } };
const front = (look: MottoLook, text = WORDS) => renderReaderCard({ card, style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), motto: { text, look } }, readerName: "andre", print: "paper", label: "x", seed: seedOf("andre") });
const sizes = (svg: string) => [...svg.matchAll(/font-size="([\d.]+)"/g)].map((match) => Number(match[1]));

test("no motto keeps today's header", () => {
  assert.deepEqual(mottoSlots(null, "rc-x-1-paper"), {});
});

test("every look but the banner and the sash lifts EX LIBRIS above the motto", () => {
  for (const look of MOTTO_LOOKS) {
    const slots = mottoSlots({ text: WORDS, look }, `rc-${look}-1-paper`);
    if (look === "bannerBelow") {
      assert.equal(slots.header, undefined);
      assert.ok(slots.banner!.length > 0);
    } else if (look === "sash") {
      assert.ok(slots.header!.startsWith(EX_LIBRIS));
    } else {
      assert.ok(slots.header!.startsWith(LIFTED_EX_LIBRIS), look);
    }
  }
});

test("every look prints the motto on the front", () => {
  for (const look of MOTTO_LOOKS) {
    const svg = front(look);
    if (look === "titleRules") assert.match(svg, />PER LIBROS AD ASTRA</, look);
    else if (look === "dropCap") assert.match(svg, />P<\/text>.*>er libros ad astra</s, look);
    else assert.match(svg, />Per libros ad astra</, look);
  }
});

test("arc and wavy ribbon put the text on a path whose id is unique to the look and print, centred by offset", () => {
  for (const look of ["arc", "wavyRibbon"] as const) {
    const slots = mottoSlots({ text: WORDS, look }, `rc-${look}-7-reversed`);
    assert.match(slots.header!, new RegExp(`<path id="rc-${look}-7-reversed" d="M`));
    assert.match(slots.header!, new RegExp(`<textPath href="#rc-${look}-7-reversed" startOffset="[\\d.]+">Per libros ad astra</textPath>`));
    assert.doesNotMatch(slots.header!, /text-anchor="middle"><textPath|<textPath[^>]*text-anchor/);
  }
  const paper = front("arc");
  assert.match(paper, new RegExp(`id="rc-arc-${seedOf("andre")}-paper"`));
});

test("a long motto stays inside every look: it shrinks, never below 5, then cuts", () => {
  for (const look of MOTTO_LOOKS) {
    const slots = mottoSlots({ text: "W".repeat(28), look }, `rc-${look}-1-paper`);
    const svg = `${slots.header ?? ""}${slots.banner ?? ""}`;
    assert.ok(sizes(svg).every((size) => size >= 5), look);
    assert.doesNotMatch(svg, /NaN|undefined/, look);
  }
});

test("motto text is escaped", () => {
  for (const look of MOTTO_LOOKS) {
    const slots = mottoSlots({ text: `<b>"x" & y</b>`, look }, `rc-${look}-1-paper`);
    const svg = `${slots.header ?? ""}${slots.banner ?? ""}`;
    assert.doesNotMatch(svg, /<b>|<\/b>/, look);
    assert.match(svg, /&lt;|&amp;/, look);
  }
});

test("the banner draws below the emblem, after the seal", () => {
  const svg = front("bannerBelow");
  assert.ok(svg.indexOf("M80 197.5H170V210.5H80Z") > svg.indexOf(`class="glyph id-lamp`));
  assert.match(svg, />EX LIBRIS</);
});
