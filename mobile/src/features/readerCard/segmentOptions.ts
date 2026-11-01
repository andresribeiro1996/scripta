import { CARD_PRINTS, LAYOUTS, TRAITS, type CardPrint, type Layout, type Trait } from "@scripta/shared";
import type { Locale } from "@scripta/shared/i18n";
import { translatorFor, type MobileMessages } from "../../i18n";

type MessageKey = Extract<keyof MobileMessages, string>;

const TRAIT_KEYS: Record<Trait, MessageKey> = { both: "readerCard.traitBoth", seal: "readerCard.traitSeal", line: "readerCard.traitLine", none: "readerCard.traitNone" };
const PRINT_KEYS: Record<CardPrint, MessageKey> = { auto: "readerCard.printAuto", paper: "readerCard.printPaper", reversed: "readerCard.printReversed" };
const LAYOUT_KEYS: Record<Layout, MessageKey> = { faces: "readerCard.layoutFaces", book: "readerCard.layoutBook", merged: "readerCard.layoutMerged" };

const segmentOptions = <T extends string>(values: readonly T[], keys: Record<T, MessageKey>, locale: Locale) => {
  const t = translatorFor(locale);
  return values.map((value) => ({ value, label: t(keys[value]) }));
};

export const traitOptions = (locale: Locale) => segmentOptions(TRAITS, TRAIT_KEYS, locale);
export const printOptions = (locale: Locale) => segmentOptions(CARD_PRINTS, PRINT_KEYS, locale);
export const layoutOptions = (locale: Locale) => segmentOptions(LAYOUTS, LAYOUT_KEYS, locale);
