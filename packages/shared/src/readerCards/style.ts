import { COUNTERS, type Counter } from "./counters.js";

export const TRAITS = ["both", "seal", "line", "none"] as const;
export type Trait = (typeof TRAITS)[number];
export const LAYOUTS = ["faces", "book", "merged"] as const;
export type Layout = (typeof LAYOUTS)[number];
export const SIGNATURE_NOTE_MAX = 60;

export interface ChosenSignature { bookKey: string; note: string | null }
export interface ChosenHighlight { bookKey: string; highlightId: string }

export interface ReaderCardStyle {
  counter: Counter;
  layout: Layout;
  trait: Trait;
  signature: ChosenSignature | null;
  highlight: ChosenHighlight | null;
}

export type ReaderCardStylePatch = Partial<ReaderCardStyle>;
export type PublicReaderCardStyle = Pick<ReaderCardStyle, "counter" | "layout" | "trait">;

export interface ReaderCardChosen {
  signature?: { title: string; author: string; workId: string | null; coverUrl: string | null; note: string | null };
  highlight?: { text: string; title: string; author: string };
}

export const DEFAULT_READER_CARD_STYLE: ReaderCardStyle = { counter: "dial", layout: "faces", trait: "both", signature: null, highlight: null };

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

export function normalizeReaderCardStyle(value: unknown): ReaderCardStyle {
  const raw = record(value) ?? {};
  return {
    counter: oneOf(COUNTERS, raw.counter, DEFAULT_READER_CARD_STYLE.counter),
    layout: oneOf(LAYOUTS, raw.layout, DEFAULT_READER_CARD_STYLE.layout),
    trait: oneOf(TRAITS, raw.trait, DEFAULT_READER_CARD_STYLE.trait),
    signature: signatureOf(raw.signature),
    highlight: highlightOf(raw.highlight),
  };
}

export function publicStyle(style: ReaderCardStyle): PublicReaderCardStyle {
  return { counter: style.counter, layout: style.layout, trait: style.trait };
}

export function rekeyReaderCardStyle(style: ReaderCardStyle, fromKeys: readonly string[], toKey: string): ReaderCardStyle {
  const from = new Set(fromKeys);
  return {
    ...style,
    signature: style.signature && from.has(style.signature.bookKey) ? { ...style.signature, bookKey: toKey } : style.signature,
    highlight: style.highlight && from.has(style.highlight.bookKey) ? { ...style.highlight, bookKey: toKey } : style.highlight,
  };
}
