import { useSyncExternalStore } from "react";
import { createTranslator, type Locale, type Translate } from "@scripta/shared/i18n";
import { en, type MobileMessages } from "./messages/en";
import { ptPT } from "./messages/pt-PT";
import { getLocale, subscribeLocale } from "./locale";

export type { MobileMessages };
export { PORTUGUESE_ENABLED } from "./flag";
export { getLocale, getLocalePreference, setDeviceLocaleTags, setLocalePreference, subscribeLocale } from "./locale";

const translators: Record<Locale, Translate<MobileMessages>> = { en: createTranslator(en), "pt-PT": createTranslator(ptPT) };

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

export function useT(): Translate<MobileMessages> {
  return translators[useLocale()];
}

export const t: Translate<MobileMessages> = (key, vars) => translators[getLocale()](key, vars);
