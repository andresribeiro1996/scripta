import { PLATES, type IdentityKey } from "./plates.js";
import type { CardState } from "./render.js";

export function readerCardLabel({ state, identity }: { state: CardState; identity: IdentityKey | null }): string {
  if (state === "unwritten" || !identity) return "Reader card: unwritten";
  const name = PLATES.find((plate) => plate.key === identity)!.name;
  return `Reader card: the ${name}${state === "leaning" ? ", leaning" : ""}`;
}

export function readerCardPlateLine(missing: string | null): string | undefined {
  return missing ? missing.charAt(0).toLowerCase() + missing.slice(1) : undefined;
}

export function readerGlyphLabel(identity?: IdentityKey): string | undefined {
  if (!identity) return undefined;
  const plate = PLATES.find((p) => p.key === identity);
  return plate ? `the ${plate.name}` : undefined;
}
