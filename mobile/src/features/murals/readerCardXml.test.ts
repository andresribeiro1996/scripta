import assert from "node:assert/strict";
import { test } from "node:test";
import { PLATE_FONTS, readerCardInputOf, renderReaderCard, type PublicReaderCard } from "@scripta/shared";
import { readerCardXml } from "./readerCardXml";

const card: PublicReaderCard = {
  state: "settled", identity: "star", runnerUp: null, streak: "lamp", signal: null, coverage: ["c"],
  dial: { segments: [{ group: "star", books: 3, marked: 1 }] },
  facts: { finished: 3, highlights: 1, series: 0, since: null, edition: 2026 },
  chosen: { signature: { title: "Fire & Blood", author: "George R. R. Martin", workId: null, coverUrl: null, note: null }, highlight: { text: "a & b", title: "Fire & Blood", author: "George R. R. Martin" } },
};
const fonts = { serif: "SERIF-X", sans: "SANS-X", mono: "MONO-X" };

test("every card font becomes a bundled family and ampersands draw as themselves", () => {
  const input = readerCardInputOf([], [], "andre", card);
  for (const page of ["front", "chosen", "record", "merged"] as const) {
    const xml = readerCardXml(renderReaderCard({ ...input, print: "paper" }, page), fonts);
    for (const family of Object.values(PLATE_FONTS)) assert.equal(xml.includes(family), false, `${page}: ${family}`);
    assert.doesNotMatch(xml, /&amp;/, page);
  }
  assert.match(readerCardXml(renderReaderCard({ ...input, print: "paper" }, "chosen"), fonts), />Fire & Blood</);
});
