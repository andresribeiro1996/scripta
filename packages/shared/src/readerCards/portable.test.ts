import assert from "node:assert/strict";
import { test } from "node:test";
import type { DialSegment } from "../library/readerCardFacts.js";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { COUNTERS } from "./counters.js";
import { PLATES, type IdentityKey } from "./plates.js";
import { renderReaderCard } from "./render.js";
import { seedOf } from "./seed.js";
import { TRAITS } from "./style.js";

const ELEMENTS = new Set(["svg", "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "textPath", "linearGradient", "radialGradient", "stop", "pattern", "clipPath", "mask", "image", "filter", "feOffset", "feFlood", "feComposite", "feMerge", "feMergeNode", "feGaussianBlur", "feColorMatrix", "feBlend", "feDropShadow"]);

function portabilityProblems(svg: string): string[] {
  const problems: string[] = [];
  for (const [, name, attrs] of svg.matchAll(/<([a-zA-Z][\w:-]*)([^>]*)>/g)) {
    if (!ELEMENTS.has(name!)) problems.push(`<${name}>`);
    for (const [, attr, value] of attrs!.matchAll(/([\w:-]+)="([^"]*)"/g)) {
      if (attr === "class" && !/^(plate|glyph) id-/.test(value!)) problems.push(`class="${value}"`);
      if (attr === "style" && value!.includes("mix-blend-mode")) problems.push("mix-blend-mode");
      if ((attr === "href" || attr === "xlink:href") && !value!.startsWith("data:")) problems.push(`${attr}="${value!.slice(0, 40)}"`);
    }
  }
  if ((svg.match(/<svg\b/g) ?? []).length !== 1) problems.push("nested <svg>");
  if (/NaN|Infinity/.test(svg)) problems.push("NaN");
  return problems;
}

const dials: Record<string, DialSegment[]> = {
  empty: [],
  small: [{ group: "star", books: 22, marked: 9 }, { group: "lamp", books: 8, marked: 1 }, { group: "unknown", books: 3, marked: 0 }],
  large: [{ group: "corr", books: 146, marked: 60 }, { group: "star", books: 47, marked: 20 }, { group: "lamp", books: 53, marked: 7 }, { group: "arch", books: 33, marked: 0 }, { group: "other", books: 41, marked: 7 }, { group: "unknown", books: 12, marked: 0 }],
};
const identities: Array<IdentityKey | null> = [...PLATES.map((plate) => plate.key), null];

test("every counter, trait, print, state and identity stays inside react-native-svg's subset", () => {
  for (const identity of identities) for (const state of identity ? (["settled", "leaning"] as const) : (["unwritten"] as const)) {
    for (const [size, segments] of Object.entries(dials)) for (const counter of COUNTERS) for (const trait of TRAITS) for (const print of ["paper", "reversed"] as const) {
      const card: PublicReaderCard = { state, identity, runnerUp: null, streak: identity === "lamp" ? "star" : "lamp", signal: null, coverage: [], dial: { segments }, facts: { finished: 0, highlights: 0, series: 0, since: null, edition: 2026 } };
      const svg = renderReaderCard({ card, style: { counter, trait }, readerName: "andre", print, label: "x", seed: seedOf("andre") });
      assert.deepEqual(portabilityProblems(svg), [], `${identity}/${state}/${size}/${counter}/${trait}/${print}`);
    }
  }
});
