import { createLocaleStore } from "@scripta/shared/i18n";
import { PORTUGUESE_ENABLED } from "./flag";

export const { getLocalePreference, setLocalePreference, setDeviceLocaleTags, subscribeLocale, getLocale } = createLocaleStore(PORTUGUESE_ENABLED);
