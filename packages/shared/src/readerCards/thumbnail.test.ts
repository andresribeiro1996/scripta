import assert from "node:assert/strict";
import { test } from "node:test";
import type { DialSegment } from "../library/readerCardFacts.js";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { COUNTERS } from "./counters.js";
import { COUNTER_LABELS, LAYOUT_LABELS, TRAIT_LABELS } from "./labels.js";
import { CARD_CROPS, cardRatio, renderReaderCard, type ReaderCardBase } from "./render.js";
import { seedOf } from "./seed.js";
import { CORNER_STYLES, DEFAULT_READER_CARD_STYLE, LAYOUTS, TRAITS, publicStyle } from "./style.js";
import { THUMBNAIL_MARKS, counterThumbnail, styleThumbnail, thumbnailSegments } from "./thumbnail.js";

const large: DialSegment[] = [{ group: "corr", books: 146, marked: 60 }, { group: "star", books: 47, marked: 20 }, { group: "lamp", books: 53, marked: 7 }, { group: "unknown", books: 12, marked: 0 }];

test("a large dial scales to about two dozen marks, keeping every genre and its share of highlights", () => {
  const scaled = thumbnailSegments(large);
  const total = scaled.reduce((sum, segment) => sum + segment.books, 0);
  assert.ok(total <= THUMBNAIL_MARKS + scaled.length, String(total));
  assert.deepEqual(scaled.map((segment) => segment.group), ["corr", "star", "lamp", "unknown"]);
  for (const segment of scaled) {
    assert.ok(segment.books >= 1);
    assert.ok(segment.marked <= segment.books);
  }
  assert.ok(scaled[0]!.books > scaled[1]!.books);
});

test("a small dial is drawn as it is", () => {
  const small: DialSegment[] = [{ group: "star", books: 8, marked: 3 }];
  assert.equal(thumbnailSegments(small), small);
});

test("a thumbnail swaps the counter and draws far fewer marks than the card", () => {
  const card: PublicReaderCard = { state: "settled", identity: "corr", runnerUp: null, signal: null, coverage: [], dial: { segments: large }, facts: { finished: 258, highlights: 300, series: 0, since: null, edition: 2026 } };
  const input: ReaderCardBase = { card, style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), counter: "dial", layout: "faces", trait: "both" }, readerName: "andre", label: "Reader card", seed: seedOf("andre"), view: "owner" };
  const thumb = counterThumbnail(input, "beads");
  assert.equal(thumb.style.counter, "beads");
  assert.equal(thumb.card.facts, card.facts);
  const marks = (svg: string) => (svg.match(/<(circle|path|rect)\b/g) ?? []).length;
  assert.ok(marks(renderReaderCard({ ...thumb, print: "paper" })) < marks(renderReaderCard({ ...input, style: thumb.style, print: "paper" })) / 2);
});

test("a card without a dial stays without one", () => {
  const card: PublicReaderCard = { state: "unwritten", identity: null, runnerUp: null, signal: null, coverage: [] };
  const input: ReaderCardBase = { card, style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), counter: "dial", layout: "faces", trait: "both" }, readerName: "andre", label: "Reader card", seed: seedOf("andre") };
  assert.equal(counterThumbnail(input, "ring").card, card);
});

test("every option has a name", () => {
  assert.deepEqual(COUNTERS.map((key) => COUNTER_LABELS[key]), ["Dial", "Beads", "Shelf", "Frame", "Ring"]);
  assert.deepEqual(TRAITS.map((key) => TRAIT_LABELS[key]), ["Both", "Seal", "Line", "None"]);
  assert.deepEqual(LAYOUTS.map((key) => LAYOUT_LABELS[key]), ["Flip", "Book", "One back"]);
});

test("a style thumbnail swaps any option, scales the dial and can crop to a region", () => {
  const card: PublicReaderCard = { state: "settled", identity: "corr", runnerUp: null, signal: null, coverage: [], dial: { segments: large }, facts: { finished: 258, highlights: 300, series: 0, since: null, edition: 2026 } };
  const input: ReaderCardBase = { card, style: publicStyle(DEFAULT_READER_CARD_STYLE), readerName: "andre", label: "Reader card", seed: seedOf("andre"), view: "owner" };
  const thumb = styleThumbnail(input, { corners: "laurel" }, "corner");
  assert.equal(thumb.style.corners, "laurel");
  assert.equal(thumb.crop, "corner");
  assert.ok(thumb.card.dial!.segments.reduce((sum, s) => sum + s.books, 0) <= THUMBNAIL_MARKS + 4);
  const svg = renderReaderCard({ ...thumb, print: "paper", width: 64 });
  assert.match(svg, /viewBox="0 0 100 100" width="64" height="64"/);
  assert.equal(styleThumbnail(input, { counter: "ring" }).crop, undefined);
});

test("crop ratios", () => {
  assert.equal(cardRatio(), 1.4);
  assert.equal(cardRatio("corner"), 1);
  assert.equal(cardRatio("motto"), CARD_CROPS.motto[3] / CARD_CROPS.motto[2]);
});
