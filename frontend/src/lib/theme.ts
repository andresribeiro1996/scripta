import { useSyncExternalStore } from "react";
import { parseThemePreference, resolveTheme, type ThemePreference, type ThemeScheme } from "@scripta/shared/themes";

const STORAGE_KEY = "theme";
const CHANGE_EVENT = "themechange";

export function osScheme(): ThemeScheme {
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(STORAGE_KEY));
  } catch (err) {
    if (err instanceof DOMException) return "system";
    throw err;
  }
}

export function applyThemePreference(preference: ThemePreference): void {
  document.documentElement.dataset.theme = resolveTheme(preference, osScheme());
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch (err) {
    if (!(err instanceof DOMException)) throw err;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, readThemePreference);
}
