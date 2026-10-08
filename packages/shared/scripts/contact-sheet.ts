import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DialSegment, PublicReaderCard } from "../src/library/index.js";
import { COUNTERS, DEFAULT_READER_CARD_STYLE, READER_PLATES, TRAITS, renderReaderCard, seedOf, type PlatePrint, type ReaderCardChosen, type ReaderCardPage, type ReaderCardStyle, type ReaderCardView } from "../src/readerCards/index.js";

const out = process.argv[2] ?? join(tmpdir(), "reader-card-sheet");
const SEGMENTS: DialSegment[] = [
  { group: "star", books: 22, marked: 9 },
  { group: "corr", books: 7, marked: 3 },
  { group: "lamp", books: 8, marked: 1 },
  { group: "arch", books: 5, marked: 0 },
  { group: "other", books: 6, marked: 1 },
];
const PRINTS: PlatePrint[] = ["paper", "reversed"];

const dimensions: Record<string, Array<[string, ReaderCardStyle]>> = {
  counters: COUNTERS.map((counter) => [counter, { ...DEFAULT_READER_CARD_STYLE, counter }]),
  traits: TRAITS.map((trait) => [trait, { ...DEFAULT_READER_CARD_STYLE, trait }]),
};

const cardOf = (index: number): PublicReaderCard => ({
  state: "settled",
  identity: READER_PLATES[index]!.key,
  runnerUp: null,
  streak: READER_PLATES[(index + 1) % READER_PLATES.length]!.key,
  signal: null,
  coverage: [],
  dial: { segments: SEGMENTS },
  facts: { finished: 48, highlights: 140, series: 12, since: 2014, edition: 2026 },
});

mkdirSync(out, { recursive: true });
for (const [name, options] of Object.entries(dimensions)) {
  const rows = options.map(([label, style]) => {
    const cards = READER_PLATES.flatMap((plate, index) => PRINTS.map((print) => renderReaderCard({ card: cardOf(index), style, readerName: "example reader", print, label: plate.name, seed: seedOf(plate.key), width: 120 })));
    return `<h2>${label}</h2><div class="row">${cards.join("")}</div>`;
  });
  writeFileSync(join(out, `${name}.html`), `<!doctype html><meta charset="utf-8"><title>${name}</title><style>body{font:14px system-ui;background:#8a8a8a;margin:16px}.row{display:flex;flex-wrap:wrap;gap:8px}</style>${rows.join("")}`);
}
const CHOSEN: ReaderCardChosen = {
  signature: { title: "A Wizard of Earthsea", author: "Ursula K. Le Guin", workId: null, coverUrl: null, note: "the one I lend to everyone" },
  highlight: { text: "To light a candle is to cast a shadow, and a long passage like this one wraps over several lines.", title: "A Wizard of Earthsea", author: "Ursula K. Le Guin" },
};
const pageRows: Array<[string, ReaderCardPage, ReaderCardView, ReaderCardChosen]> = [
  ["record · owner", "record", "owner", CHOSEN],
  ["record · visitor", "record", "visitor", CHOSEN],
  ["chosen · both", "chosen", "visitor", CHOSEN],
  ["chosen · book only", "chosen", "visitor", { signature: CHOSEN.signature }],
  ["chosen · highlight only", "chosen", "visitor", { highlight: CHOSEN.highlight }],
  ["chosen · owner, nothing chosen", "chosen", "owner", {}],
  ["merged · owner", "merged", "owner", CHOSEN],
  ["merged · visitor, nothing chosen", "merged", "visitor", {}],
];
const pageHtml = pageRows.map(([label, page, view, chosen]) => {
  const cards = READER_PLATES.flatMap((plate, index) => PRINTS.map((print) => renderReaderCard({ card: { ...cardOf(index), chosen }, style: DEFAULT_READER_CARD_STYLE, readerName: "example reader", print, label: plate.name, seed: seedOf(plate.key), width: 160, view, leaders: [{ label: "Earthsea", count: 4 }, { label: "Discworld", count: 3 }], missing: null }, page)));
  return `<h2>${label}</h2><div class="row">${cards.join("")}</div>`;
});
writeFileSync(join(out, "pages.html"), `<!doctype html><meta charset="utf-8"><title>pages</title><style>body{font:14px system-ui;background:#8a8a8a;margin:16px}.row{display:flex;flex-wrap:wrap;gap:8px}</style>${pageHtml.join("")}`);
console.log(out);
