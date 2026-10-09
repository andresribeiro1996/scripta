import type { DialGroup } from "../library/readerCardFacts.js";
import type { PublicReaderCard, ReaderLeader } from "../library/readerIdentity.js";
import { composePage, composePlate, cornerMarkup, SANS, type PlateFace, type PlateSlots } from "./compose.js";
import { cornersSlot } from "./corners.js";
import { drawCounter, SEAL_ANGLE } from "./counters.js";
import { finishLayers } from "./finishes.js";
import { footerSlots, GENRE_LEADS, truncateName } from "./footer.js";
import { mottoSlots } from "./mottos.js";
import { inks, withStyle } from "./paint.js";
import { PLATES, emblem, glyph, glyphBody, type IdentityKey } from "./plates.js";
import { chosenBody, mergedBody, recordBody, type ReaderCardPage, type ReaderCardView } from "./pages.js";
import type { PublicReaderCardStyle } from "./style.js";
import { escape } from "./svgText.js";

export type PlatePrint = "paper" | "reversed";
export type CardCrop = "motto" | "corner";
export const CARD_CROPS: Record<CardCrop, readonly [number, number, number, number]> = { motto: [30, 18, 190, 210], corner: [0, 0, 100, 100] };
export function cardRatio(crop?: CardCrop): number {
  if (!crop) return 1.4;
  const [, , w, h] = CARD_CROPS[crop];
  return h / w;
}
export type CardState = "settled" | "leaning" | "unwritten";

export interface RenderPlateOptions {
  identity: IdentityKey | null;
  state: CardState;
  readerName: string;
  print: PlatePrint;
  label: string;
  unwrittenLine?: string;
  width?: number;
  crop?: CardCrop;
}

function faceOf({ identity, state, readerName, label, unwrittenLine, width = 250, crop }: RenderPlateOptions): { face: PlateFace; ink: IdentityKey | "graph" } {
  const cropped = crop === "corner";
  const reader = escape(truncateName(readerName).toUpperCase());
  const safeLabel = escape(label);
  if (state === "unwritten" || !identity) {
    return { ink: "graph", face: { key: "none", emblemSvg: cropped ? "" : emblem("none"), name: "Unwritten", eyebrow: "NOT YET", epithet: escape(unwrittenLine ?? "five finished books to begin"), numeral: "—", reader, width, label: safeLabel, ...(crop ? { viewBox: CARD_CROPS[crop] } : {}) } };
  }
  const p = PLATES.find((item) => item.key === identity)!;
  return { ink: identity, face: { key: identity, emblemSvg: cropped ? "" : emblem(identity), name: p.name, eyebrow: state === "leaning" ? "LEANING TOWARD" : "THE", epithet: p.epithet, numeral: p.numeral, reader, width, label: safeLabel, ...(crop ? { viewBox: CARD_CROPS[crop] } : {}) } };
}

export function renderPlate(options: RenderPlateOptions): string {
  const { face, ink } = faceOf(options);
  return withStyle(composePlate(face), inks(ink, options.print));
}

export interface ReaderCardInput {
  card: PublicReaderCard;
  style: PublicReaderCardStyle;
  readerName: string;
  print: PlatePrint;
  label: string;
  unwrittenLine?: string;
  seed: number;
  width?: number;
  crop?: CardCrop;
  view?: ReaderCardView;
  leaders?: ReaderLeader[];
  missing?: string | null;
}

export type ReaderCardBase = Omit<ReaderCardInput, "print">;

const SEAL_SIZE = 26;
const SEAL_RADIUS = 64;

function glyphAt(key: IdentityKey, x: number, y: number, size: number, print: PlatePrint): string {
  return `<g class="glyph id-${key}" transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${(size / 48).toFixed(4)})">${withStyle(glyphBody(key), inks(key, print))}</g>`;
}

function sealCentre(): { x: number; y: number } {
  const rad = (SEAL_ANGLE * Math.PI) / 180;
  return { x: 125 + SEAL_RADIUS * Math.sin(rad), y: 134 - SEAL_RADIUS * Math.cos(rad) };
}

function sealSlot(streak: IdentityKey, print: PlatePrint): string {
  const { x: cx, y: cy } = sealCentre();
  return `<circle class="pg" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${SEAL_SIZE / 2 + 2.5}"/>${glyphAt(streak, cx - SEAL_SIZE / 2, cy - SEAL_SIZE / 2, SEAL_SIZE, print)}`;
}

function traitLine(streak: IdentityKey): string {
  const name = PLATES.find((item) => item.key === streak)!.name.toUpperCase();
  return `<text class="pt" x="125" y="297" text-anchor="middle" font-size="5.6" letter-spacing="1.5" font-family="${SANS}" font-weight="600">WITH A STREAK OF THE ${name}</text>`;
}

function decorations(input: ReaderCardInput, print: PlatePrint): PlateSlots {
  const corners = cornersSlot(input.style.corners);
  const footer = footerSlots(input.style.footer, { card: input.card, readerName: input.readerName, glyph: (key, x, y, size) => glyphAt(key, x, y, size, print) });
  return { ...(corners === undefined ? {} : { corners }), ...footer };
}

const BACKS = { record: [", reader’s record", recordBody], chosen: [", chosen by the reader", chosenBody], merged: [", back", mergedBody] } as const;

export function renderReaderCard(input: ReaderCardInput, page: ReaderCardPage = "front"): string {
  const { card, style, print, seed } = input;
  const { face, ink } = faceOf({ ...input, identity: card.identity, state: card.state });
  const streak = card.state === "unwritten" ? null : card.streak ?? null;
  const seal = streak !== null && (style.trait === "both" || style.trait === "seal");
  const decorated: PlateSlots = { ...decorations(input, print), ...(page === "front" ? mottoSlots(style.motto, `rc-${style.motto?.look ?? "none"}-${seed}-${print}`) : {}) };
  const finish = finishLayers(style.finish, { print, ink, streak, seed, front: page === "front", seal: page === "front" && seal ? sealCentre() : null, corners: cornerMarkup(decorated) });
  if (page !== "front") {
    const [suffix, body] = BACKS[page];
    return withStyle(composePage({ ...face, label: `${face.label}${suffix}` }, body(input), { ...decorated, ...finish.slots }), finish.palette);
  }
  const line = streak !== null && (style.trait === "both" || style.trait === "line");
  const lead = card.identity && GENRE_LEADS.has(card.identity) ? (card.identity as DialGroup) : null;
  const slots: PlateSlots = { ...decorated, ...finish.slots };
  const counter = card.dial ? drawCounter(style.counter, card.dial.segments, { seed, sealGap: seal, lead }) : null;
  if (counter) slots[counter.slot] = counter.svg;
  if (streak && seal) slots.seal = sealSlot(streak, print);
  if (streak && line) slots.trait = traitLine(streak);
  return withStyle(composePlate(face, slots, finish.wrapInk), finish.palette);
}

export function renderGlyph(identity: IdentityKey, size: number, print: PlatePrint): string {
  return withStyle(glyph(identity, size), inks(identity, print));
}
