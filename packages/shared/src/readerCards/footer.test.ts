import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { footerLeftText, footerRightText, footerSlots, type FooterContext } from "./footer.js";
import { renderReaderCard } from "./render.js";
import { seedOf } from "./seed.js";
import { DEFAULT_READER_CARD_STYLE, FOOTER_LEFTS, FOOTER_RIGHTS, publicStyle, type CardFooter, type FooterLeft, type FooterRight } from "./style.js";
import { escapeText } from "./svgText.js";

const card = (fields: Partial<PublicReaderCard> = {}): PublicReaderCard => ({
  state: "settled", identity: "star", runnerUp: null, streak: "lamp", signal: null, coverage: [],
  dial: { segments: [{ group: "star", books: 40, marked: 9 }, { group: "lamp", books: 8, marked: 1 }] },
  facts: { finished: 48, highlights: 140, series: 12, since: 2014, edition: 2026, readerNumber: 42 },
  ...fields,
});
const ctx = (fields: Partial<PublicReaderCard> = {}, readerName = "andre.ribeiro"): FooterContext => ({ card: card(fields), readerName, glyph: (key, x, y, size) => `<g data-glyph="${key} ${x} ${y} ${size}"/>` });
const left = (value: FooterLeft, fields: Partial<PublicReaderCard> = {}) => footerSlots({ left: value, right: "name" }, ctx(fields, "andre")).footerLeft;
const right = (value: FooterRight, readerName = "andre.ribeiro") => footerSlots({ left: "plate", right: value }, ctx({}, readerName)).footerRight;
const text = (svg: string | undefined) => svg?.match(/>([^<]*)<\/text>/)?.[1];

test("the default corners leave the compose defaults in place", () => {
  assert.deepEqual(footerSlots({ left: "plate", right: "name" }, ctx()), {});
});

test("each left value prints its fact", () => {
  assert.equal(text(left("plateName")), "IV · STARGAZER");
  assert.equal(text(left("since")), "READER SINCE 2014");
  assert.equal(text(left("est")), "EST. MMXIV");
  assert.equal(text(left("volumes")), "XLVIII VOLUMES");
  assert.equal(text(left("volumes", { facts: { finished: 1, highlights: 0, series: 0, since: null, edition: 2026 } })), "I VOLUME");
  assert.equal(text(left("highlights")), "CXL HIGHLIGHTS");
  assert.equal(text(left("series")), "XII SERIES");
  assert.equal(text(left("genre")), "FANTASY &amp; SF");
  assert.equal(text(left("edition")), "EDITION MMXXVI");
  assert.equal(text(left("readerNumber")), "Nº XLII");
  assert.equal(left("glyph"), `<g data-glyph="star 30 309.5 13"/>`);
  assert.equal(left("none"), "");
});

test("an unavailable value falls back to the corner's default", () => {
  const none = { facts: { finished: 0, highlights: 0, series: 0, since: null, edition: 2026 } };
  for (const value of ["since", "est", "volumes", "highlights", "series", "readerNumber"] as const) assert.equal(left(value, none), undefined, value);
  assert.equal(left("genre", { identity: "anno" }), undefined);
  assert.equal(left("genre", { dial: { segments: [{ group: "lamp", books: 3, marked: 0 }] } }), undefined);
  for (const value of ["plateName", "glyph", "genre"] as const) assert.equal(left(value, { state: "unwritten", identity: null }), undefined, value);
  assert.equal(left("edition", { facts: undefined }), undefined);
});

test("each right value prints the username's parts", () => {
  assert.equal(text(right("firstName")), "ANDRE");
  assert.equal(text(right("lastName")), "RIBEIRO");
  assert.equal(text(right("firstInitial")), "ANDRE R.");
  assert.equal(text(right("initials")), "A. R.");
  assert.equal(text(right("catalog")), "RIBEIRO, A.");
  assert.equal(text(right("handle")), "@ANDRE.RIBEIRO");
  assert.match(right("nameItalic")!, /font-style="italic" font-family="'Playfair Display'[^"]*">Andre Ribeiro</);
  assert.match(right("signature")!, /font-family="'Pinyon Script'[^"]*">Andre Ribeiro</);
  assert.match(right("monogram")!, /<circle class="pl" cx="212" cy="316" r="7".*>AR<\/text>/);
  assert.match(right("monogramDiamond")!, /M212 309L219 316L212 323L205 316Z.*>AR<\/text>/);
  assert.equal(right("none"), "");
});

test("a single-part username falls back to the name for its missing parts", () => {
  for (const value of ["firstName", "lastName", "firstInitial", "initials", "catalog"] as const) assert.equal(right(value, "andre"), undefined, value);
  assert.match(right("monogram", "andre")!, />A<\/text>/);
  assert.equal(text(right("handle", "andre")), "@ANDRE");
});

test("a 30-character handle is cut to its corner and the left value gives way to a wide right", () => {
  const handle = text(right("handle", "a".repeat(30)))!;
  assert.ok(handle.endsWith("…"), handle);
  const slots = footerSlots({ left: "edition", right: "handle" }, ctx({}, "a".repeat(30)));
  assert.ok(text(slots.footerLeft)!.endsWith("…"));
});

test("the chosen footer draws on the front and on every back page", () => {
  const footer: CardFooter = { left: "since", right: "initials" };
  for (const page of ["front", "chosen", "record", "merged"] as const) {
    const svg = renderReaderCard({ card: card(), style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), footer }, readerName: "andre.ribeiro", print: "paper", label: "x", seed: seedOf("andre"), view: "owner" }, page);
    assert.match(svg, />READER SINCE 2014</, page);
    assert.match(svg, />A\. R\.</, page);
    assert.doesNotMatch(svg, />PLATE IV</, page);
  }
});

test("the glyph footer is the identity's glyph, inked like the seal", () => {
  const svg = renderReaderCard({ card: card(), style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), footer: { left: "glyph", right: "name" } }, readerName: "andre", print: "paper", label: "x", seed: seedOf("andre") });
  assert.match(svg, /<g class="glyph id-star" transform="translate\(30.00 309.50\) scale\(0.2708\)">/);
});

const unwritten = { state: "unwritten", identity: null, dial: null, facts: undefined } as const;
const bare = { facts: { finished: 0, highlights: 0, series: 0, since: null, edition: 2026 } };

test("footerLeftText says what each corner will print", () => {
  assert.equal(footerLeftText("plate", card()), "PLATE IV");
  assert.equal(footerLeftText("plate", card(unwritten)), "PLATE —");
  assert.equal(footerLeftText("plateName", card()), "IV · STARGAZER");
  assert.equal(footerLeftText("since", card()), "READER SINCE 2014");
  assert.equal(footerLeftText("volumes", card()), "XLVIII VOLUMES");
  assert.equal(footerLeftText("readerNumber", card()), "Nº XLII");
  for (const value of ["since", "volumes", "readerNumber"] as const) assert.equal(footerLeftText(value, card(bare)), null, value);
  assert.equal(footerLeftText("plateName", card(unwritten)), null);
  assert.equal(footerLeftText("glyph", card()), null);
  assert.equal(footerLeftText("none", card()), null);
});

test("footerRightText says what each corner will print", () => {
  assert.equal(footerRightText("name", "andre.ribeiro"), "ANDRE.RIBEIRO");
  assert.equal(footerRightText("name", "a".repeat(20)), `${"A".repeat(16)}…`);
  assert.equal(footerRightText("firstName", "andre.ribeiro"), "ANDRE");
  assert.equal(footerRightText("initials", "andre.ribeiro"), "A. R.");
  assert.equal(footerRightText("catalog", "andre.ribeiro"), "RIBEIRO, A.");
  assert.equal(footerRightText("handle", "andre.ribeiro"), "@ANDRE.RIBEIRO");
  assert.equal(footerRightText("nameItalic", "andre.ribeiro"), "Andre Ribeiro");
  assert.equal(footerRightText("signature", "andre.ribeiro"), "Andre Ribeiro");
  assert.equal(footerRightText("monogram", "andre.ribeiro"), "AR");
  assert.equal(footerRightText("monogramDiamond", "andre"), "A");
  for (const value of ["firstName", "lastName", "firstInitial", "initials", "catalog"] as const) assert.equal(footerRightText(value, "andre"), null, value);
  assert.equal(footerRightText("none", "andre.ribeiro"), null);
});

test("every printed text the editor shows is on the rendered front", () => {
  const render = (footer: CardFooter, fields: Partial<PublicReaderCard>, readerName: string) =>
    renderReaderCard({ card: card(fields), style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), footer }, readerName, print: "paper", label: "x", seed: seedOf("andre") });
  for (const [fields, readerName] of [[{}, "andre.ribeiro"], [bare, "andre"], [unwritten, "a".repeat(30)]] as const) {
    for (const value of FOOTER_LEFTS) {
      const printed = footerLeftText(value, card(fields));
      if (printed !== null) assert.ok(render({ left: value, right: "none" }, fields, readerName).includes(`>${escapeText(printed)}<`), `${value} ${printed}`);
    }
    for (const value of FOOTER_RIGHTS) {
      const printed = footerRightText(value, readerName);
      if (printed !== null) assert.ok(render({ left: "plate", right: value }, fields, readerName).includes(`>${escapeText(printed)}<`), `${value} ${printed}`);
    }
  }
});
