import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { readerCardSummary } from "./pages.js";
import type { ReaderCardBase } from "./render.js";
import { seedOf } from "./seed.js";
import { DEFAULT_READER_CARD_STYLE, publicStyle } from "./style.js";

const card: PublicReaderCard = {
  state: "settled", identity: "star", runnerUp: null, streak: "lamp",
  signal: { counted: 22, of: 34, label: "22 of 34 finished books with known genres are fantasy or science fiction" },
  coverage: ["genres known for 34 of 34 finished books"],
  dial: { segments: [{ group: "star", books: 22, marked: 9 }, { group: "lamp", books: 12, marked: 1 }] },
  facts: { finished: 34, highlights: 40, series: 2, since: 2014, edition: 2026 },
  chosen: { signature: { title: "A Wizard of Earthsea", author: "Ursula K. Le Guin", workId: null, coverUrl: null, note: "lent twice" }, highlight: { text: "To light a candle", title: "A Wizard of Earthsea", author: "Ursula K. Le Guin" } },
};
const base = (fields: Partial<ReaderCardBase> = {}): ReaderCardBase => ({ card, style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), counter: "dial", layout: "faces", trait: "both" }, readerName: "andre", label: "Reader card", seed: seedOf("andre"), view: "visitor", ...fields });

test("the summary reads the card in order: plate, streak, evidence, choices, coverage", () => {
  assert.deepEqual(readerCardSummary(base()), [
    "The Stargazer, plate IV: lives half in other worlds.",
    "With a streak of the Lamplighter.",
    "22 of 34 finished books with known genres are fantasy or science fiction.",
    "34 finished books: 22 fantasy & sf, 12 mystery & crime. 10 with highlights.",
    "Signature book: A Wizard of Earthsea by Ursula K. Le Guin, “lent twice”.",
    "Highlight: “To light a candle”, Ursula K. Le Guin, A Wizard of Earthsea.",
    "genres known for 34 of 34 finished books",
  ]);
});

test("only the owner's summary names the leaders and the missing line", () => {
  const owner = { card: { ...card, state: "leaning" as const }, leaders: [{ label: "Earthsea", count: 4 }], missing: "Close between the Stargazer and the Lamplighter" };
  const mine = readerCardSummary(base({ ...owner, view: "owner" }));
  assert.ok(mine.includes("Only you see: Earthsea (4)."));
  assert.ok(mine.includes("Only you see: Close between the Stargazer and the Lamplighter."));
  assert.doesNotMatch(readerCardSummary(base({ ...owner, view: "visitor" })).join(" "), /Earthsea \(4\)|Close between/);
});

test("an unwritten card says so", () => {
  assert.equal(readerCardSummary(base({ card: { state: "unwritten", identity: null, runnerUp: null, signal: null, coverage: [] } }))[0], "An unwritten reader card.");
});

test("the motto is read out after the plate", () => {
  const lines = readerCardSummary(base({ style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), motto: { text: "Per libros ad astra", look: "arc" } } }));
  assert.equal(lines[1], "Motto: “Per libros ad astra”.");
});
