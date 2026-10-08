import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { renderReaderCard, type ReaderCardInput } from "./render.js";
import { seedOf } from "./seed.js";
import { DEFAULT_READER_CARD_STYLE, FINISHES, publicStyle, type Finish, type PublicReaderCardStyle } from "./style.js";

const card: PublicReaderCard = { state: "settled", identity: "star", runnerUp: null, streak: "carto", signal: null, coverage: ["c"], dial: { segments: [{ group: "star", books: 22, marked: 9 }] }, facts: { finished: 22, highlights: 9, series: 2, since: 2014, edition: 2026 } };
const input = (finish: Finish, print: "paper" | "reversed" = "paper", patch: Partial<PublicReaderCardStyle> = {}): ReaderCardInput => ({ card, style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), finish, ...patch }, readerName: "andre.ribeiro", print, label: "x", seed: seedOf("andre.ribeiro"), view: "owner" });
const BUILT = FINISHES.filter((finish) => finish !== "paper");

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

test("foil and holo print the front in a gradient ink, and the back in plain ink", () => {
  for (const finish of ["foil", "holo"] as const) for (const print of ["paper", "reversed"] as const) {
    const front = renderReaderCard(input(finish, print));
    assert.match(front, new RegExp(`<text style="fill:url\\(#rc-${finish}Ink-\\d+-${print}\\)"`), `${finish}/${print}`);
    assert.match(front, new RegExp(`<linearGradient id="rc-${finish}Ink-\\d+-${print}" gradientUnits="userSpaceOnUse"`), `${finish}/${print}`);
    assert.doesNotMatch(renderReaderCard(input(finish, print), "record"), /:url\(/, `${finish}/${print} back`);
  }
  assert.match(renderReaderCard(input("holo")), /fill="url\(#rc-holoSheen-\d+-paper\)"/);
});

test("gilt paints the frame, corners and edge gold and leaves the name in the plate ink", () => {
  const svg = renderReaderCard(input("gilt"));
  assert.match(svg, /<rect style="stroke:url\(#rc-goldInk-\d+-paper\);fill:none" x="10" y="10"/);
  assert.match(svg, /<path style="fill:url\(#rc-goldInk-\d+-paper\)" d="M16 11\.5/);
  assert.match(svg, /stroke="url\(#rc-goldInk-\d+-paper\)" stroke-width="1.5"/);
  assert.match(svg, /<text style="fill:#5b3b6e"[^>]*font-size="25"/);
  assert.match(renderReaderCard(input("gilt"), "record"), /stroke:url\(#rc-goldInk-/);
});

test("stamp breaks and tilts the front ink inside a mask larger than the card, and leaves the back straight", () => {
  const svg = renderReaderCard(input("stamp"));
  assert.match(svg, /<g mask="url\(#rc-stampMask-\d+-paper\)" transform="rotate\(-1.2 125 175\)"/);
  assert.match(svg, /<mask id="rc-stampMask-\d+-paper" maskUnits="userSpaceOnUse" x="-10" y="-10" width="270" height="370">/);
  assert.doesNotMatch(renderReaderCard(input("stamp"), "record"), /rotate\(|stampMask-\d+-paper\)"/);
});

test("riso prints a misregistered copy in the streak's ink, or riso red without one", () => {
  assert.match(renderReaderCard(input("riso")), /<g transform="translate\(1.4 .9\)" opacity=".6">[\s\S]*?fill:#1f4e6b/);
  assert.match(renderReaderCard({ ...input("riso"), card: { ...card, streak: null } }), /fill:#e4572e/);
});

test("letterpress debosses the ink with an offset highlight on cotton paper", () => {
  const svg = renderReaderCard(input("letterpress"));
  assert.match(svg, /<rect style="fill:#f5f0e6" width="250"/);
  assert.match(svg, /<g transform="translate\(.6 .7\)" opacity="0.8">/);
});

test("ink copies keep every id unique, and the copied motto still finds its curve", () => {
  for (const finish of ["riso", "letterpress"] as const) {
    const svg = renderReaderCard(input(finish, "paper", { motto: { text: "Per libros ad astra", look: "arc" } }));
    const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]!);
    assert.equal(new Set(ids).size, ids.length, finish);
    for (const [, ref] of svg.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(ref!), `${finish} → ${ref}`);
    assert.ok((svg.match(/<textPath/g)?.length ?? 0) >= 2, finish);
  }
});
