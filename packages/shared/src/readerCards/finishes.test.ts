import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { renderReaderCard, type ReaderCardInput } from "./render.js";
import { seedOf } from "./seed.js";
import { DEFAULT_READER_CARD_STYLE, publicStyle, type Finish, type PublicReaderCardStyle } from "./style.js";

const card: PublicReaderCard = { state: "settled", identity: "star", runnerUp: null, streak: "carto", signal: null, coverage: ["c"], dial: { segments: [{ group: "star", books: 22, marked: 9 }] }, facts: { finished: 22, highlights: 9, series: 2, since: 2014, edition: 2026 } };
const input = (finish: Finish, print: "paper" | "reversed" = "paper", patch: Partial<PublicReaderCardStyle> = {}): ReaderCardInput => ({ card, style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), finish, ...patch }, readerName: "andre.ribeiro", print, label: "x", seed: seedOf("andre.ribeiro"), view: "owner" });
const BUILT: Finish[] = ["aged", "linen", "vellum", "watercolor", "kraft"];

test("a style without a finish draws exactly the plain card", () => {
  const plain = renderReaderCard(input("paper"));
  const style: Partial<PublicReaderCardStyle> = { ...input("paper").style };
  delete style.finish;
  assert.equal(renderReaderCard({ ...input("paper"), style: style as PublicReaderCardStyle }), plain);
  assert.equal(renderReaderCard(input("neon" as Finish)), plain);
});

test("every finish draws its own card in both prints, the same way twice", () => {
  for (const finish of BUILT) for (const print of ["paper", "reversed"] as const) {
    const svg = renderReaderCard(input(finish, print));
    assert.notEqual(svg, renderReaderCard(input("paper", print)), `${finish}/${print}`);
    assert.equal(renderReaderCard(input(finish, print)), svg, `${finish}/${print} is deterministic`);
  }
});

test("paper finishes change the paper and leave the ink", () => {
  for (const [finish, ground] of [["aged", "#eadab9"], ["linen", "#ece3cf"], ["vellum", "#efe2c4"], ["kraft", "#caa97c"]] as const) {
    assert.match(renderReaderCard(input(finish)), new RegExp(`<rect style="fill:${ground}" width="250" height="350" rx="4"/>`), finish);
  }
  assert.match(renderReaderCard(input("aged")), /<text style="fill:#5b3b6e"[^>]*font-size="25"/);
});

test("textured finishes paint through a mask of their tile", () => {
  for (const finish of ["vellum", "kraft"] as const) {
    const svg = renderReaderCard(input(finish));
    assert.match(svg, /<image href="data:image\/png;base64,/, finish);
    assert.match(svg, new RegExp(`mask="url\\(#rc-${finish}Mask-\\d+-paper\\)"`), finish);
  }
});

test("watercolour washes the seal only when the seal is drawn", () => {
  assert.match(renderReaderCard(input("watercolor", "paper", { trait: "both" })), /fill="#1f4e6b" opacity="0.28"/);
  assert.doesNotMatch(renderReaderCard(input("watercolor", "paper", { trait: "line" })), /opacity="0.28"/);
});

test("back pages keep the finish's paper", () => {
  for (const page of ["record", "chosen", "merged"] as const) assert.match(renderReaderCard(input("aged"), page), /<rect style="fill:#eadab9" width="250"/, page);
});
