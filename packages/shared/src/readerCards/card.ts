import { PLATES, type IdentityKey } from "./plates.js";
import type { CardState } from "./render.js";
import type { ReaderIdentity } from "../library/readerIdentity.js";

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

export function ownGlyphPreview({ state, identity }: ReaderIdentity): { glyph: IdentityKey | null; line: string } {
  if (state === "settled" && identity) {
    const name = PLATES.find((p) => p.key === identity)!.name;
    return { glyph: identity, line: `Others see you as the ${name}.` };
  }
  return { glyph: null, line: "Your reader card isn't settled yet, so no glyph shows." };
}
