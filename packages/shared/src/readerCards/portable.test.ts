import assert from "node:assert/strict";
import { test } from "node:test";
import type { DialSegment } from "../library/readerCardFacts.js";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { COUNTERS } from "./counters.js";
import type { ReaderCardPage } from "./pages.js";
import { PLATES, type IdentityKey } from "./plates.js";
import { renderReaderCard } from "./render.js";
import { random, seedOf } from "./seed.js";
import { CARD_PRINTS, CORNER_STYLES, DEFAULT_READER_CARD_STYLE, FINISHES, FOOTER_LEFTS, FOOTER_RIGHTS, MOTTO_LOOKS, TRAITS, publicStyle, type PublicReaderCardStyle, type ReaderCardChosen } from "./style.js";

const ELEMENTS = new Set(["svg", "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "textPath", "linearGradient", "radialGradient", "stop", "pattern", "clipPath", "mask", "image", "filter", "feOffset", "feFlood", "feComposite", "feMerge", "feMergeNode", "feGaussianBlur", "feColorMatrix", "feBlend", "feDropShadow"]);

function portabilityProblems(svg: string): string[] {
  const problems: string[] = [];
  let remoteImages = 0;
  const ids = [...svg.matchAll(/ id="([^"]*)"/g)].map((match) => match[1]!);
  if (new Set(ids).size !== ids.length) problems.push("duplicate id");
  for (const [, name, attrs] of svg.matchAll(/<([a-zA-Z][\w:-]*)([^>]*)>/g)) {
    if (!ELEMENTS.has(name!)) problems.push(`<${name}>`);
    for (const [, attr, value] of attrs!.matchAll(/([\w:-]+)="([^"]*)"/g)) {
      if (attr === "class" && !/^(plate|glyph) id-/.test(value!)) problems.push(`class="${value}"`);
      if (attr === "style" && value!.includes("mix-blend-mode")) problems.push("mix-blend-mode");
      const remote = (attr === "href" || attr === "xlink:href") && name === "image" && /^https:\/\/[^\s"'<>&\\]+$/.test(value!);
      const local = attr === "href" && name === "textPath" && value!.startsWith("#") && ids.includes(value!.slice(1));
      if (remote) remoteImages++;
      if ((attr === "href" || attr === "xlink:href") && !value!.startsWith("data:") && !remote && !local) problems.push(`${attr}="${value!.slice(0, 40)}"`);
      if (attr === "id" && !/^rc-[a-zA-Z]+-\d+-(paper|reversed)$/.test(value!)) problems.push(`id="${value}"`);
    }
  }
  if ((svg.match(/<svg\b/g) ?? []).length !== 1) problems.push("nested <svg>");
  if (remoteImages > 1) problems.push("more than one remote image");
  for (const [, ref] of svg.matchAll(/url\(\s*['"]?#([^)'"\s]+)/g)) if (!ids.includes(ref!)) problems.push(`url(#${ref})`);
  if (/NaN|Infinity|undefined/.test(svg)) problems.push("NaN");
  return problems;
}

test("the guard counts every remote image and lets url(#…) point only at the card's own ids", () => {
  const twoImages = `<svg xmlns="http://www.w3.org/2000/svg"><image xlink:href="https://a.example/b" width="1"/><image x="2" href="https://a.example/c"/></svg>`;
  assert.deepEqual(portabilityProblems(twoImages), ["more than one remote image"]);
  assert.deepEqual(portabilityProblems(`<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url( #a)"/></svg>`), ["url(#a)"]);
  assert.deepEqual(portabilityProblems(`<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="rc-foilInk-1-paper"/></defs><rect style="fill:url(#rc-foilInk-1-paper)"/></svg>`), []);
});

test("the guard allows only card ids and textPath references to them", () => {
  const ok = `<svg xmlns="http://www.w3.org/2000/svg"><defs><path id="rc-arc-1-paper" d="M0 0"/></defs><text><textPath href="#rc-arc-1-paper">a</textPath></text></svg>`;
  assert.deepEqual(portabilityProblems(ok), []);
  assert.deepEqual(portabilityProblems(ok.replace(`href="#rc-arc-1-paper"`, `href="#elsewhere"`)), [`href="#elsewhere"`]);
  assert.ok(portabilityProblems(ok.replaceAll("rc-arc-1-paper", "x")).includes(`id="x"`));
  assert.ok(portabilityProblems(ok.replace("</defs>", `<path id="rc-arc-1-paper" d="M1 1"/></defs>`)).includes("duplicate id"));
});

const dials: Record<string, DialSegment[]> = {
  empty: [],
  small: [{ group: "star", books: 22, marked: 9 }, { group: "lamp", books: 8, marked: 1 }, { group: "unknown", books: 3, marked: 0 }],
  large: [{ group: "corr", books: 146, marked: 60 }, { group: "star", books: 47, marked: 20 }, { group: "lamp", books: 53, marked: 7 }, { group: "arch", books: 33, marked: 0 }, { group: "other", books: 41, marked: 7 }, { group: "unknown", books: 12, marked: 0 }],
};
const identities: Array<IdentityKey | null> = [...PLATES.map((plate) => plate.key), null];

test("every counter, trait, print, state and identity stays inside react-native-svg's subset", () => {
  for (const [index, identity] of identities.entries()) for (const state of identity ? (["settled", "leaning"] as const) : (["unwritten"] as const)) {
    for (const [size, segments] of Object.entries(dials)) for (const counter of COUNTERS) for (const trait of TRAITS) for (const print of ["paper", "reversed"] as const) {
      const card: PublicReaderCard = { state, identity, runnerUp: null, streak: PLATES[(index + 1) % PLATES.length]!.key, signal: null, coverage: [], dial: { segments }, facts: { finished: 0, highlights: 0, series: 0, since: null, edition: 2026 } };
      const svg = renderReaderCard({ card, style: { ...DEFAULT_READER_CARD_STYLE, counter, trait }, readerName: "andre", print, label: "x", seed: seedOf("andre") });
      assert.deepEqual(portabilityProblems(svg), [], `${identity}/${state}/${size}/${counter}/${trait}/${print}`);
    }
  }
});

const chosenSets: Record<string, ReaderCardChosen> = {
  none: {},
  book: { signature: { title: "A Wizard of Earthsea", author: "Ursula K. Le Guin", workId: null, coverUrl: "https://covers.example.org/earthsea.jpg", note: "lent twice" } },
  quote: { highlight: { text: "To light a candle is to cast a shadow.", title: "A Wizard of Earthsea", author: "Ursula K. Le Guin" } },
  both: { signature: { title: "A Wizard of Earthsea", author: "Ursula K. Le Guin", workId: null, coverUrl: null, note: null }, highlight: { text: "word ".repeat(90), title: "T", author: "A" } },
};

test("every back page, view, choice and print stays inside the subset, and a visitor's never shows owner data", () => {
  const secrets = { leaders: [{ label: "SECRET-LEADER", count: 3 }], missing: "SECRET-MISSING" };
  for (const [index, identity] of identities.entries()) for (const state of identity ? (["settled", "leaning"] as const) : (["unwritten"] as const)) {
    for (const [size, segments] of Object.entries({ empty: dials.empty!, large: dials.large! })) for (const [set, chosen] of Object.entries(chosenSets)) {
      const smuggled: ReaderCardChosen = chosen.highlight ? { ...chosen, highlight: { ...chosen.highlight, annotation: "SECRET-NOTE" } as never } : chosen;
      const card: PublicReaderCard = { state, identity, runnerUp: null, streak: PLATES[(index + 1) % PLATES.length]!.key, signal: null, coverage: ["c"], dial: { segments }, facts: { finished: 0, highlights: 0, series: 0, since: null, edition: 2026 }, chosen: smuggled };
      for (const page of ["chosen", "record", "merged"] as ReaderCardPage[]) for (const view of ["owner", "visitor"] as const) for (const print of ["paper", "reversed"] as const) {
        const svg = renderReaderCard({ card, style: { ...DEFAULT_READER_CARD_STYLE, layout: "faces" }, readerName: "andre", print, label: "x", seed: seedOf("andre"), view, ...secrets }, page);
        const where = `${identity}/${state}/${size}/${set}/${page}/${view}/${print}`;
        assert.deepEqual(portabilityProblems(svg), [], where);
        assert.doesNotMatch(svg, /SECRET-NOTE/, where);
        if (view === "visitor") assert.doesNotMatch(svg, /SECRET-LEADER|SECRET-MISSING/, where);
      }
    }
  }
});

const LONG = "W".repeat(28);
const decorationsOf: Array<[string, Partial<PublicReaderCardStyle>]> = [
  ...MOTTO_LOOKS.flatMap((look): Array<[string, Partial<PublicReaderCardStyle>]> => [[`motto ${look}`, { motto: { text: "Per libros ad astra", look } }], [`long motto ${look}`, { motto: { text: LONG, look } }]]),
  ...FOOTER_LEFTS.map((left): [string, Partial<PublicReaderCardStyle>] => [`left ${left}`, { footer: { left, right: "name" } }]),
  ...FOOTER_RIGHTS.map((right): [string, Partial<PublicReaderCardStyle>] => [`right ${right}`, { footer: { left: "plate", right } }]),
  ...CORNER_STYLES.map((corners): [string, Partial<PublicReaderCardStyle>] => [`corners ${corners}`, { corners }]),
  ...FINISHES.map((finish): [string, Partial<PublicReaderCardStyle>] => [`finish ${finish}`, { finish }]),
];

test("every motto, footer and corner stays inside the subset on every plate and print, and draws the same twice", () => {
  for (const [index, identity] of identities.entries()) for (const [name, patch] of decorationsOf) for (const print of ["paper", "reversed"] as const) {
    const card: PublicReaderCard = { state: identity ? "settled" : "unwritten", identity, runnerUp: null, streak: PLATES[(index + 1) % PLATES.length]!.key, signal: null, coverage: ["c"], dial: { segments: dials.small! }, facts: { finished: 48, highlights: 140, series: 12, since: 2014, edition: 2026, readerNumber: 42 } };
    const input = { card, style: { ...publicStyle(DEFAULT_READER_CARD_STYLE), ...patch }, readerName: "andre.ribeiro", print, label: "x", seed: seedOf("andre.ribeiro"), view: "owner" as const };
    for (const page of ["front", "record"] as const) {
      const svg = renderReaderCard(input, page);
      assert.deepEqual(portabilityProblems(svg), [], `${identity}/${name}/${print}/${page}`);
      assert.equal(renderReaderCard(input, page), svg, `${identity}/${name}/${print}/${page} is deterministic`);
    }
  }
});

test("fifty seeded combinations of every dimension stay inside the subset", () => {
  const next = random(seedOf("reader-card-combinations"));
  const pick = <T,>(options: readonly T[]) => options[Math.floor(next() * options.length)]!;
  for (let i = 0; i < 50; i++) {
    const identity = pick(identities);
    const card: PublicReaderCard = { state: identity ? pick(["settled", "leaning"] as const) : "unwritten", identity, runnerUp: null, streak: pick(PLATES).key, signal: null, coverage: ["c"], dial: { segments: pick(Object.values(dials)) }, facts: { finished: 48, highlights: pick([0, 140]), series: 12, since: pick([null, 2014]), edition: 2026 }, chosen: pick(Object.values(chosenSets)) };
    const style: PublicReaderCardStyle = { counter: pick(COUNTERS), layout: "faces", trait: pick(TRAITS), motto: pick([null, { text: pick(["Per libros ad astra", LONG, "x"]), look: pick(MOTTO_LOOKS) }]), footer: { left: pick(FOOTER_LEFTS), right: pick(FOOTER_RIGHTS) }, corners: pick(CORNER_STYLES), finish: pick(FINISHES), print: pick(CARD_PRINTS) };
    for (const page of ["front", "chosen", "record", "merged"] as const) for (const print of ["paper", "reversed"] as const) {
      const svg = renderReaderCard({ card, style, readerName: pick(["andre", "andre.ribeiro", "a".repeat(30)]), print, label: "x", seed: seedOf(String(i)), view: pick(["owner", "visitor"] as const) }, page);
      assert.deepEqual(portabilityProblems(svg), [], `combination ${i}/${page}/${print}`);
    }
  }
});
