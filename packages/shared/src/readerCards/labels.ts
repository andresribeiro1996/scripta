import type { Counter } from "./counters.js";
import type { Layout, Trait } from "./style.js";

export const COUNTER_LABELS: Record<Counter, string> = { dial: "Dial", beads: "Beads", shelf: "Shelf", frame: "Frame", ring: "Ring" };
export const TRAIT_LABELS: Record<Trait, string> = { both: "Line and seal", seal: "Seal", line: "Line", none: "None" };
export const LAYOUT_LABELS: Record<Layout, string> = { faces: "Three faces", book: "Book", merged: "One back" };
