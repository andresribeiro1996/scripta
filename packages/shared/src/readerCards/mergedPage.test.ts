import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { renderReaderCard, type ReaderCardInput } from "./render.js";
import { seedOf } from "./seed.js";

const card: PublicReaderCard = {
  state: "settled", identity: "star", runnerUp: null, streak: "lamp", signal: null, coverage: ["genres known for 34 of 34 finished books"],
  dial: { segments: [{ group: "star", books: 22, marked: 9 }, { group: "lamp", books: 12, marked: 1 }] },
  facts: { finished: 34, highlights: 40, series: 2, since: 2014, edition: 2026 },
  chosen: { signature: { title: "A Wizard of Earthsea", author: "Ursula K. Le Guin", workId: null, coverUrl: null, note: null }, highlight: { text: "To light a candle is to cast a shadow.", title: "A Wizard of Earthsea", author: "Ursula K. Le Guin" } },
};
const merged = (fields: Partial<ReaderCardInput> = {}) => renderReaderCard({ card, style: { counter: "dial", layout: "merged", trait: "both" }, readerName: "andre", print: "paper", label: "Reader card", seed: seedOf("andre"), view: "visitor", ...fields }, "merged");
const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]!);

test("the merged back has the chosen book and highlight above compact rows with only the lead genre", () => {
  const all = texts(merged());
  for (const expected of ["SIGNATURE BOOK", "Finished", "34", "Fantasy &amp; SF", "22 · 65%", "With highlights", "10", "Runner-up", "Lamplighter", "genres known for 34 of 34 finished books", "A Wizard of Earthsea", "URSULA K. LE GUIN · A WIZARD OF EARTHSEA"]) assert.ok(all.includes(expected), expected);
  assert.ok(all.some((line) => line.startsWith("“To light")));
  assert.ok(!all.includes("Mystery & crime"));
});

test("only the owner's merged back shows the leaders", () => {
  const owner = { view: "owner" as const, leaders: [{ label: "Earthsea", count: 4 }] };
  assert.ok(texts(merged(owner)).includes("◇ Earthsea"));
  assert.doesNotMatch(merged({ ...owner, view: "visitor" }), /Earthsea/);
});

test("with nothing chosen a visitor's merged back starts with the record header", () => {
  const all = texts(merged({ card: { ...card, chosen: {} } }));
  assert.ok(all.includes("READER’S RECORD"));
  assert.ok(!all.includes("SIGNATURE BOOK"));
});
