import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { renderReaderCard, type ReaderCardInput } from "./render.js";
import { seedOf } from "./seed.js";

const card: PublicReaderCard = {
  state: "settled", identity: "star", runnerUp: null, streak: "lamp",
  signal: { counted: 22, of: 44, label: "22 of 44 finished books with known genres are fantasy or science fiction" },
  coverage: ["genres known for 44 of 48 finished books"],
  dial: { segments: [{ group: "star", books: 22, marked: 9 }, { group: "lamp", books: 8, marked: 1 }, { group: "unknown", books: 4, marked: 0 }] },
  facts: { finished: 34, highlights: 40, series: 2, since: 2014, edition: 2026 },
};
const input = (fields: Partial<ReaderCardInput> = {}): ReaderCardInput => ({ card, style: { counter: "dial", layout: "faces", trait: "both" }, readerName: "andre", print: "paper", label: "Reader card", seed: seedOf("andre"), view: "visitor", ...fields });
const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]!);

test("the record lists finished, each genre segment with the lead's share, highlights and the runner-up", () => {
  const svg = renderReaderCard(input(), "record");
  const all = texts(svg);
  for (const expected of ["READER’S RECORD", "THE STARGAZER · PLATE IV", "Finished", "34", "Fantasy &amp; SF", "22 · 65%", "Mystery &amp; crime", "8", "Genre unknown", "4", "With highlights", "10", "Runner-up", "Lamplighter", "the dial: one mark per finished book;", "genres known for 44 of 48 finished books"]) {
    assert.ok(all.includes(expected), expected);
  }
  assert.match(svg, /Courier Prime/);
});

test("the legend follows the counter", () => {
  assert.ok(texts(renderReaderCard(input({ style: { counter: "ring", layout: "faces", trait: "both" } }), "record")).includes("the ring: one arc per genre,"));
});

test("only the owner sees the leaders and, when leaning, the missing line", () => {
  const leaning: PublicReaderCard = { ...card, state: "leaning" };
  const owner = { card: leaning, view: "owner" as const, leaders: [{ label: "Earthsea", count: 4 }], missing: "Close between the Stargazer and the Lamplighter" };
  const mine = texts(renderReaderCard(input(owner), "record"));
  assert.ok(mine.includes("◇ Earthsea"));
  assert.ok(mine.some((line) => line.startsWith("◇ Close between")));
  const theirs = renderReaderCard(input({ ...owner, view: "visitor" }), "record");
  assert.doesNotMatch(theirs, /Earthsea|Close between/);
  assert.doesNotMatch(renderReaderCard(input({ ...owner, view: undefined }), "record"), /Earthsea|Close between/);
});

test("an older card without dial, facts or streak draws a record with no counter legend and nothing undefined", () => {
  const svg = renderReaderCard(input({ card: { state: "settled", identity: "star", runnerUp: null, signal: null, coverage: [] } }), "record");
  assert.ok(texts(svg).includes("READER’S RECORD"));
  assert.doesNotMatch(svg, /undefined|NaN|the dial/);
});

test("row text is escaped and cut to its width", () => {
  const svg = renderReaderCard(input({ view: "owner", leaders: [{ label: "<b>Fire & Blood</b>", count: 2 }, { label: "A".repeat(80), count: 1 }] }), "record");
  assert.match(svg, /&lt;b&gt;Fire &amp; Blood/);
  assert.doesNotMatch(svg, /<b>/);
  assert.ok(texts(svg).some((line) => line.startsWith("◇ AAAA") && line.endsWith("…")));
});

test("the front is unchanged when no page is named", () => {
  assert.equal(renderReaderCard(input()), renderReaderCard(input(), "front"));
});
