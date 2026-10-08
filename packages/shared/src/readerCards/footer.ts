import type { PublicReaderCard } from "../library/readerIdentity.js";
import { SANS, SCRIPT, SERIF, type PlateSlots } from "./compose.js";
import { fitLine, textWidth } from "./fit.js";
import { displayName, nameParts, roman } from "./numerals.js";
import { GROUP_LABELS } from "./pages.js";
import { PLATES, type IdentityKey } from "./plates.js";
import type { CardFooter, FooterLeft, FooterRight } from "./style.js";
import { escapeText } from "./svgText.js";

export const GENRE_LEADS: ReadonlySet<string> = new Set(["lamp", "star", "arch", "corr"]);
export const truncateName = (name: string) => (name.length > 16 ? `${name.slice(0, 16)}…` : name);

export interface FooterContext { card: PublicReaderCard; readerName: string; glyph: (key: IdentityKey, x: number, y: number, size: number) => string }

const ROOM = 190;
const GAP = 12;
const MIN_LEFT = 40;
const MAX_RIGHT = 100;
const CAPS = { font: "caps", size: 7.5, spacing: 1.8 } as const;

const caps = (text: string, x: number, end: boolean, width: number) =>
  `<text class="pt" x="${x}" y="321"${end ? ` text-anchor="end"` : ""} font-size="7.5" letter-spacing="1.8" font-family="${SANS}" font-weight="600">${escapeText(fitLine(text, { ...CAPS, width }))}</text>`;
const plateOf = (card: PublicReaderCard) => (card.state !== "unwritten" && card.identity ? PLATES.find((plate) => plate.key === card.identity) : undefined);
const counted = (n: number | undefined, one: string, many: string) => (n ? `${roman(n)} ${n === 1 ? one : many}` : null);
const initial = (word: string) => [...word][0] ?? "";

function leftText(value: FooterLeft, card: PublicReaderCard): string | null {
  const facts = card.facts;
  const plate = plateOf(card);
  switch (value) {
    case "plateName": return plate ? `${plate.numeral} · ${plate.name.toUpperCase()}` : null;
    case "since": return facts?.since ? `READER SINCE ${facts.since}` : null;
    case "est": return facts?.since ? `EST. ${roman(facts.since)}` : null;
    case "volumes": return counted(facts?.finished, "VOLUME", "VOLUMES");
    case "highlights": return counted(facts?.highlights, "HIGHLIGHT", "HIGHLIGHTS");
    case "series": return counted(facts?.series, "SERIES", "SERIES");
    case "genre": {
      const lead = plate && GENRE_LEADS.has(plate.key) ? card.dial?.segments.find((segment) => segment.group === plate.key) : undefined;
      return lead ? GROUP_LABELS[lead.group].toUpperCase() : null;
    }
    case "edition": return facts?.edition ? `EDITION ${roman(facts.edition)}` : null;
    case "readerNumber": return facts?.readerNumber ? `Nº ${roman(facts.readerNumber)}` : null;
    default: return null;
  }
}

function leftSlot(value: FooterLeft, ctx: FooterContext, width: number): string | undefined {
  if (value === "none") return "";
  if (value === "glyph") {
    const plate = plateOf(ctx.card);
    return plate ? ctx.glyph(plate.key, 30, 309.5, 13) : undefined;
  }
  const text = leftText(value, ctx.card);
  return text ? caps(text, 30, false, width) : undefined;
}

interface Right { svg?: string; width: number }

function rightSlot(value: FooterRight, readerName: string): Right {
  const { first, last } = nameParts(readerName);
  const F = first.toUpperCase();
  const L = last?.toUpperCase() ?? null;
  const monogram = escapeText(`${initial(F)}${L ? initial(L) : ""}`);
  const text = (content: string): Right => {
    const shown = fitLine(content, { ...CAPS, width: MAX_RIGHT });
    return { svg: caps(shown, 220, true, MAX_RIGHT), width: textWidth(shown, CAPS) };
  };
  switch (value) {
    case "firstName": if (L) return text(F); break;
    case "lastName": if (L) return text(L); break;
    case "firstInitial": if (L) return text(`${F} ${initial(L)}.`); break;
    case "initials": if (L) return text(`${initial(F)}. ${initial(L)}.`); break;
    case "catalog": if (L) return text(`${L}, ${initial(F)}.`); break;
    case "handle": return text(`@${readerName.toUpperCase()}`);
    case "nameItalic": {
      const shown = fitLine(displayName(readerName), { font: "serif", size: 9, width: MAX_RIGHT });
      return { svg: `<text class="pt" x="220" y="321" text-anchor="end" font-size="9" font-style="italic" font-family="${SERIF}">${escapeText(shown)}</text>`, width: textWidth(shown, { font: "serif", size: 9 }) };
    }
    case "signature": {
      const shown = fitLine(displayName(readerName), { font: "script", size: 12, width: MAX_RIGHT });
      return { svg: `<text class="pt" x="221" y="323" text-anchor="end" font-size="12" font-family="${SCRIPT}">${escapeText(shown)}</text>`, width: textWidth(shown, { font: "script", size: 12 }) };
    }
    case "monogram": return { svg: `<circle class="pl" cx="212" cy="316" r="7" stroke-width=".8"/><circle class="pl" cx="212" cy="316" r="5.6" stroke-width=".35"/><text class="pt" x="212" y="318.2" text-anchor="middle" font-size="6" font-family="${SERIF}">${monogram}</text>`, width: 15 };
    case "monogramDiamond": return { svg: `<path class="pl" d="M212 309L219 316L212 323L205 316Z" stroke-width=".8"/><text class="pt" x="212" y="318.1" text-anchor="middle" font-size="5.6" font-family="${SERIF}">${monogram}</text>`, width: 15 };
    case "none": return { svg: "", width: 0 };
  }
  return { width: textWidth(truncateName(readerName).toUpperCase(), CAPS) };
}

export function footerSlots(footer: CardFooter, ctx: FooterContext): Pick<PlateSlots, "footerLeft" | "footerRight"> {
  const right = rightSlot(footer.right, ctx.readerName);
  const left = leftSlot(footer.left, ctx, Math.max(MIN_LEFT, ROOM - right.width - GAP));
  return { ...(left === undefined ? {} : { footerLeft: left }), ...(right.svg === undefined ? {} : { footerRight: right.svg }) };
}
