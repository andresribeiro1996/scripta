import { COUNTERS, type Counter } from "./counters.js";

export const TRAITS = ["both", "seal", "line", "none"] as const;
export type Trait = (typeof TRAITS)[number];

export interface ReaderCardStyle {
  counter: Counter;
  trait: Trait;
}

export const DEFAULT_READER_CARD_STYLE: ReaderCardStyle = { counter: "dial", trait: "both" };

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

export function normalizeReaderCardStyle(value: unknown): ReaderCardStyle {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    counter: oneOf(COUNTERS, raw.counter, DEFAULT_READER_CARD_STYLE.counter),
    trait: oneOf(TRAITS, raw.trait, DEFAULT_READER_CARD_STYLE.trait),
  };
}
