import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { COUNTERS } from "./counters.js";
import { renderPlate, renderReaderCard } from "./render.js";
import { seedOf } from "./seed.js";
import { DEFAULT_READER_CARD_STYLE, TRAITS, normalizeReaderCardStyle, type ReaderCardStyle } from "./style.js";

const card = (fields: Partial<PublicReaderCard> = {}): PublicReaderCard => ({
  state: "settled", identity: "star", runnerUp: null, streak: "lamp", signal: null, coverage: [],
  dial: { segments: [{ group: "star", books: 22, marked: 9 }, { group: "lamp", books: 8, marked: 1 }] },
  facts: { finished: 30, highlights: 40, series: 2, since: 2014, edition: 2026 },
  ...fields,
});
const render = (fields: Partial<PublicReaderCard> = {}, style: ReaderCardStyle = DEFAULT_READER_CARD_STYLE, print: "paper" | "reversed" = "paper") =>
  renderReaderCard({ card: card(fields), style, readerName: "andre", print, label: "Reader card", seed: seedOf("andre") });
const plain = renderPlate({ identity: "star", state: "settled", readerName: "andre", print: "paper", label: "Reader card" });

test("the default card draws the dial, the streak line and the streak's seal", () => {
  const svg = render();
  assert.match(svg, />WITH A STREAK OF THE LAMPLIGHTER</);
  assert.match(svg, /class="glyph id-lamp/);
  assert.match(svg, /stroke-width="1.15"/);
});

test("the trait setting picks line, seal, both or neither", () => {
  const traits = Object.fromEntries(TRAITS.map((trait) => {
    const svg = render({}, { ...DEFAULT_READER_CARD_STYLE, trait });
    return [trait, [/WITH A STREAK/.test(svg), /glyph id-lamp/.test(svg)]];
  }));
  assert.deepEqual(traits, { both: [true, true], seal: [false, true], line: [true, false], none: [false, false] });
});

test("a card with no streak draws no trait", () => {
  const svg = render({ streak: null });
  assert.doesNotMatch(svg, /WITH A STREAK/);
  assert.doesNotMatch(svg, /class="glyph/);
});

test("an older card without streak, dial or facts draws today's plate", () => {
  assert.equal(render({ streak: undefined, dial: undefined, facts: undefined }), plain);
});

test("an empty dial draws no counter", () => {
  assert.equal(render({ streak: null, dial: { segments: [] } }), plain);
});

test("an unwritten card keeps its counter but never a trait", () => {
  const svg = render({ state: "unwritten", identity: null, streak: "lamp" });
  assert.match(svg, />Unwritten</);
  assert.doesNotMatch(svg, /WITH A STREAK/);
  assert.match(svg, /stroke-width=".6" stroke-linecap="round" opacity=".8"/);
});

test("every counter, trait and print renders fully inlined", () => {
  for (const counter of COUNTERS) for (const trait of TRAITS) for (const print of ["paper", "reversed"] as const) {
    const svg = render({}, { counter, trait }, print);
    assert.doesNotMatch(svg, / class="\w+"/);
    assert.doesNotMatch(svg, /<style>|NaN/);
  }
});

test("normalising keeps known options and falls back field by field", () => {
  assert.deepEqual(normalizeReaderCardStyle(null), DEFAULT_READER_CARD_STYLE);
  assert.deepEqual(normalizeReaderCardStyle({ counter: "shelf", trait: "sparkle", extra: 1 }), { ...DEFAULT_READER_CARD_STYLE, counter: "shelf" });
});
