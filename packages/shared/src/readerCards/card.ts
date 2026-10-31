import type { Locale } from "../i18n/locale.js";
import { sharedT } from "../i18n/sharedT.js";
import { PLATES, plateName, type IdentityKey } from "./plates.js";
import type { CardState } from "./render.js";
import type { ReaderIdentity } from "../library/readerIdentity.js";

export function readerCardLabel({ state, identity }: { state: CardState; identity: IdentityKey | null }, locale: Locale): string {
  const t = sharedT(locale);
  if (state === "unwritten" || !identity) return t("shared.readerCard.labelUnwritten");
  return t(state === "leaning" ? "shared.readerCard.labelLeaning" : "shared.readerCard.labelPlate", { name: plateName(identity, locale) });
}

export function readerCardPlateLine(missing: string | null): string | undefined {
  return missing ? missing.charAt(0).toLowerCase() + missing.slice(1) : undefined;
}

export function readerGlyphLabel(identity: IdentityKey | undefined, locale: Locale): string | undefined {
  if (!identity) return undefined;
  const plate = PLATES.find((p) => p.key === identity);
  return plate ? sharedT(locale)("shared.readerCard.glyphLabel", { name: plateName(plate.key, locale) }) : undefined;
}

export function ownGlyphPreview({ state, identity }: ReaderIdentity, locale: Locale): { glyph: IdentityKey | null; line: string } {
  const t = sharedT(locale);
  if (state === "settled" && identity) return { glyph: identity, line: t("shared.readerCard.ownSettled", { name: plateName(identity, locale) }) };
  return { glyph: null, line: t("shared.readerCard.ownUnsettled") };
}
