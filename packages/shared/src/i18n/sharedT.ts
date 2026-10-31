import type { Locale } from "./locale.js";
import { en } from "./messages/en.js";
import { ptPT } from "./messages/pt-PT.js";
import { createTranslator, type Translate } from "./translate.js";

export type SharedMessages = typeof en;

const translators: Record<Locale, Translate<SharedMessages>> = {
  en: createTranslator(en),
  "pt-PT": createTranslator(ptPT),
};

export function sharedT(locale: Locale): Translate<SharedMessages> {
  return translators[locale];
}
