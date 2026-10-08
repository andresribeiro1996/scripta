import { COUNTERS, type Counter } from "./counters.js";
import type { PlatePrint } from "./render.js";

export const TRAITS = ["both", "seal", "line", "none"] as const;
export type Trait = (typeof TRAITS)[number];
export const LAYOUTS = ["faces", "book", "merged"] as const;
export type Layout = (typeof LAYOUTS)[number];
export const SIGNATURE_NOTE_MAX = 60;

export function noteToSend(value: string, lastSent: string | null): string | null | undefined {
  const note = value.trim() || null;
  return note === lastSent ? undefined : note;
}

export function draftSaver(initial: string | null, rollback: (failed: string, previous: string | null) => void): (value: string, save: (next: string | null) => Promise<boolean>) => void {
  let sent = initial;
  return (value, save) => {
    const next = noteToSend(value, sent);
    if (next === undefined) return;
    const previous = sent;
    sent = next;
    void save(next).then((saved) => {
      if (saved) return;
      sent = previous;
      rollback(value, previous);
    });
  };
}

export const MOTTO_LOOKS = ["ribbon", "scroll", "arc", "cartouche", "rule", "bannerBelow", "wavyRibbon", "titleRules", "dropCap", "sash", "script", "plaque"] as const;
export type MottoLook = (typeof MOTTO_LOOKS)[number];
export const MOTTO_MAX = 28;
export const FOOTER_LEFTS = ["plate", "plateName", "since", "est", "volumes", "highlights", "series", "genre", "edition", "readerNumber", "glyph", "none"] as const;
export type FooterLeft = (typeof FOOTER_LEFTS)[number];
export const FOOTER_RIGHTS = ["name", "firstName", "lastName", "firstInitial", "initials", "catalog", "handle", "nameItalic", "signature", "monogram", "monogramDiamond", "none"] as const;
export type FooterRight = (typeof FOOTER_RIGHTS)[number];
export const CORNER_STYLES = ["diamonds", "deco", "fleuron", "photo", "stars", "laurel", "knot", "volute", "meander", "rosette", "register", "none"] as const;
export type CornerStyle = (typeof CORNER_STYLES)[number];
export const CARD_PRINTS = ["auto", "paper", "reversed"] as const;
export type CardPrint = (typeof CARD_PRINTS)[number];

export interface CardMotto { text: string; look: MottoLook }
export interface CardFooter { left: FooterLeft; right: FooterRight }

export interface ChosenSignature { bookKey: string; note: string | null }
export interface ChosenHighlight { bookKey: string; highlightId: string }

export interface ReaderCardStyle {
  counter: Counter;
  layout: Layout;
  trait: Trait;
  motto: CardMotto | null;
  footer: CardFooter;
  corners: CornerStyle;
  print: CardPrint;
  signature: ChosenSignature | null;
  highlight: ChosenHighlight | null;
}

export type ReaderCardStylePatch = Partial<ReaderCardStyle>;
export type PublicReaderCardStyle = Pick<ReaderCardStyle, "counter" | "layout" | "trait" | "motto" | "footer" | "corners" | "print">;

export interface ReaderCardChosen {
  signature?: { title: string; author: string; workId: string | null; coverUrl: string | null; note: string | null };
  highlight?: { text: string; title: string; author: string };
}

export const DEFAULT_READER_CARD_STYLE: ReaderCardStyle = { counter: "dial", layout: "faces", trait: "both", motto: null, footer: { left: "plate", right: "name" }, corners: "diamonds", print: "auto", signature: null, highlight: null };

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

const key = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null);
const record = (value: unknown) => (value && typeof value === "object" ? (value as Record<string, unknown>) : null);

function signatureOf(value: unknown): ChosenSignature | null {
  const raw = record(value);
  const bookKey = key(raw?.bookKey);
  if (!bookKey) return null;
  const note = typeof raw?.note === "string" ? raw.note.trim().slice(0, SIGNATURE_NOTE_MAX) : "";
  return { bookKey, note: note || null };
}

function highlightOf(value: unknown): ChosenHighlight | null {
  const raw = record(value);
  const bookKey = key(raw?.bookKey), highlightId = key(raw?.highlightId);
  return bookKey && highlightId ? { bookKey, highlightId } : null;
}

function mottoOf(value: unknown): CardMotto | null {
  const raw = record(value);
  const text = typeof raw?.text === "string" ? [...raw.text.trim()].slice(0, MOTTO_MAX).join("").trim() : "";
  return text ? { text, look: oneOf(MOTTO_LOOKS, raw?.look, "ribbon") } : null;
}

function footerOf(value: unknown): CardFooter {
  const raw = record(value);
  return { left: oneOf(FOOTER_LEFTS, raw?.left, DEFAULT_READER_CARD_STYLE.footer.left), right: oneOf(FOOTER_RIGHTS, raw?.right, DEFAULT_READER_CARD_STYLE.footer.right) };
}

export function normalizeReaderCardStyle(value: unknown): ReaderCardStyle {
  const raw = record(value) ?? {};
  return {
    counter: oneOf(COUNTERS, raw.counter, DEFAULT_READER_CARD_STYLE.counter),
    layout: oneOf(LAYOUTS, raw.layout, DEFAULT_READER_CARD_STYLE.layout),
    trait: oneOf(TRAITS, raw.trait, DEFAULT_READER_CARD_STYLE.trait),
    motto: mottoOf(raw.motto),
    footer: footerOf(raw.footer),
    corners: oneOf(CORNER_STYLES, raw.corners, DEFAULT_READER_CARD_STYLE.corners),
    print: oneOf(CARD_PRINTS, raw.print, DEFAULT_READER_CARD_STYLE.print),
    signature: signatureOf(raw.signature),
    highlight: highlightOf(raw.highlight),
  };
}

export function publicStyle(style: ReaderCardStyle): PublicReaderCardStyle {
  return { counter: style.counter, layout: style.layout, trait: style.trait, motto: style.motto, footer: style.footer, corners: style.corners, print: style.print };
}

export function resolvePrint(print: CardPrint, dark: boolean): PlatePrint {
  return print === "auto" ? (dark ? "reversed" : "paper") : print;
}

export function rekeyReaderCardStyle(style: ReaderCardStyle, fromKeys: readonly string[], toKey: string): ReaderCardStyle {
  const from = new Set(fromKeys);
  return {
    ...style,
    signature: style.signature && from.has(style.signature.bookKey) ? { ...style.signature, bookKey: toKey } : style.signature,
    highlight: style.highlight && from.has(style.highlight.bookKey) ? { ...style.highlight, bookKey: toKey } : style.highlight,
  };
}
