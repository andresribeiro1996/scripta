import { parseLocalePreference } from "@scripta/shared/i18n";
import { getLocale, getLocalePreference, setDeviceLocaleTags, setLocalePreference, subscribeLocale } from "./locale";

const STORAGE_KEY = "locale";

function readStoredPreference() {
  try {
    return parseLocalePreference(localStorage.getItem(STORAGE_KEY));
  } catch (err) {
    if (err instanceof DOMException) return "auto";
    throw err;
  }
}

function persistPreference(): void {
  try {
    localStorage.setItem(STORAGE_KEY, getLocalePreference());
  } catch (err) {
    if (!(err instanceof DOMException)) throw err;
  }
}

export function installBrowserLocale(): void {
  setLocalePreference(readStoredPreference());
  setDeviceLocaleTags(window.navigator.languages);
  function follow() {
    document.documentElement.lang = getLocale();
    persistPreference();
  }
  follow();
  subscribeLocale(follow);
  window.addEventListener("languagechange", () => setDeviceLocaleTags(window.navigator.languages));
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) setLocalePreference(parseLocalePreference(event.newValue));
  });
}
