import type { DialGroup } from "../library/readerCardFacts.js";
import type { PublicReaderCard } from "../library/readerIdentity.js";
import { composePlate, SANS, type PlateFace, type PlateSlots } from "./compose.js";
import { drawCounter, SEAL_ANGLE } from "./counters.js";
import { INKS, PAPER, PLATES, REVERSED_LINE, emblems, glyph, glyphBody, type IdentityKey } from "./plates.js";
import type { ReaderCardStyle } from "./style.js";

export type PlatePrint = "paper" | "reversed";
export type CardState = "settled" | "leaning" | "unwritten";

export interface RenderPlateOptions {
  identity: IdentityKey | null;
  state: CardState;
  readerName: string;
  print: PlatePrint;
  label: string;
  unwrittenLine?: string;
  width?: number;
}

function inks(key: IdentityKey | "graph", print: PlatePrint): [string, string] {
  const [, ink, deep] = INKS[key];
  return print === "paper" ? [PAPER, ink] : [deep, REVERSED_LINE];
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const truncateName = (name: string) => (name.length > 16 ? `${name.slice(0, 16)}…` : name);

const rules = (g: string, l: string): Record<string, string> => ({
  pg: `fill:${g}`, pgf: `fill:${g}`, gg: `fill:${g}`,
  pf: `fill:${l}`, pt: `fill:${l}`, gd: `fill:${l}`, gi: `fill:${l}`,
  pl: `stroke:${l};fill:none`, gk: `stroke:${l};fill:none`,
  pgs: `stroke:${g};fill:none`, gr: `stroke:${g};fill:none`, gs: `stroke:${g};fill:none`,
  pgl: `fill:${g};stroke:${l}`,
});

const withStyle = (svg: string, [g, l]: [string, string]) => {
  const r = rules(g, l);
  return svg.replace(/ class="(\w+)"/g, (_, c: string) => {
    const style = r[c];
    if (!style) throw new Error(`No print rule for class "${c}"`);
    return ` style="${style}"`;
  });
};

function faceOf({ identity, state, readerName, label, unwrittenLine, width = 250 }: RenderPlateOptions): { face: PlateFace; ink: IdentityKey | "graph" } {
  const reader = escape(truncateName(readerName).toUpperCase());
  const safeLabel = escape(label);
  if (state === "unwritten" || !identity) {
    return { ink: "graph", face: { key: "none", emblemSvg: emblems.none(), name: "Unwritten", eyebrow: "NOT YET", epithet: escape(unwrittenLine ?? "five finished books to begin"), numeral: "—", reader, width, label: safeLabel } };
  }
  const p = PLATES.find((item) => item.key === identity)!;
  return { ink: identity, face: { key: identity, emblemSvg: emblems[identity](), name: p.name, eyebrow: state === "leaning" ? "LEANING TOWARD" : "THE", epithet: p.epithet, numeral: p.numeral, reader, width, label: safeLabel } };
}

export function renderPlate(options: RenderPlateOptions): string {
  const { face, ink } = faceOf(options);
  return withStyle(composePlate(face), inks(ink, options.print));
}

export interface ReaderCardInput {
  card: PublicReaderCard;
  style: Pick<ReaderCardStyle, "counter" | "trait">;
  readerName: string;
  print: PlatePrint;
  label: string;
  unwrittenLine?: string;
  seed: number;
  width?: number;
}

const GENRE_LEADS: ReadonlySet<string> = new Set(["lamp", "star", "arch", "corr"]);
const SEAL_SIZE = 26;
const SEAL_RADIUS = 64;

function sealSlot(streak: IdentityKey, print: PlatePrint): string {
  const rad = (SEAL_ANGLE * Math.PI) / 180;
  const cx = 125 + SEAL_RADIUS * Math.sin(rad), cy = 134 - SEAL_RADIUS * Math.cos(rad);
  const glyphSvg = `<g class="glyph id-${streak}" transform="translate(${(cx - SEAL_SIZE / 2).toFixed(2)} ${(cy - SEAL_SIZE / 2).toFixed(2)}) scale(${(SEAL_SIZE / 48).toFixed(4)})">${withStyle(glyphBody(streak), inks(streak, print))}</g>`;
  return `<circle class="pg" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${SEAL_SIZE / 2 + 2.5}"/>${glyphSvg}`;
}

function traitLine(streak: IdentityKey): string {
  const name = PLATES.find((item) => item.key === streak)!.name.toUpperCase();
  return `<text class="pt" x="125" y="297" text-anchor="middle" font-size="5.6" letter-spacing="1.5" font-family="${SANS}" font-weight="600">WITH A STREAK OF THE ${name}</text>`;
}

export function renderReaderCard(input: ReaderCardInput): string {
  const { card, style, print, seed } = input;
  const { face, ink } = faceOf({ ...input, identity: card.identity, state: card.state });
  const streak = card.state === "unwritten" ? null : card.streak ?? null;
  const seal = streak !== null && (style.trait === "both" || style.trait === "seal");
  const line = streak !== null && (style.trait === "both" || style.trait === "line");
  const lead = card.identity && GENRE_LEADS.has(card.identity) ? (card.identity as DialGroup) : null;
  const slots: PlateSlots = {};
  const counter = card.dial ? drawCounter(style.counter, card.dial.segments, { seed, sealGap: seal, lead }) : null;
  if (counter) slots[counter.slot] = counter.svg;
  if (streak && seal) slots.seal = sealSlot(streak, print);
  if (streak && line) slots.trait = traitLine(streak);
  return withStyle(composePlate(face, slots), inks(ink, print));
}

export function renderGlyph(identity: IdentityKey, size: number, print: PlatePrint): string {
  return withStyle(glyph(identity, size), inks(identity, print));
}
