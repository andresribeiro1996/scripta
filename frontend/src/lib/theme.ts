import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { parseFontPreference, parseThemePreference, resolveTheme, type Appearance, type FontPreference, type FontSlot, type ThemePreference, type ThemeScheme } from "@scripta/shared/themes";

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

export function fadeToThemePreference(preference: ThemePreference): void {
  const doc = document as Document & { startViewTransition?: (update: () => void) => { ready: Promise<void>; finished: Promise<void> } };
  if (typeof doc.startViewTransition !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    applyThemePreference(preference);
    return;
  }
  const transition = doc.startViewTransition(() => flushSync(() => applyThemePreference(preference)));
  const skipped = (err: unknown) => {
    if (!(err instanceof DOMException)) throw err;
  };
  transition.ready.catch(skipped);
  transition.finished.catch(skipped);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribe, readThemePreference);
}

const FONT_KEYS: Record<FontSlot, "fontDisplay" | "fontText"> = { display: "fontDisplay", text: "fontText" };

export function readFontPreference(slot: FontSlot): FontPreference {
  try {
    return parseFontPreference(slot, localStorage.getItem(FONT_KEYS[slot]));
  } catch (err) {
    if (err instanceof DOMException) return "theme";
    throw err;
  }
}

export function applyFontPreference(slot: FontSlot, preference: FontPreference): void {
  const key = FONT_KEYS[slot];
  if (preference === "theme") delete document.documentElement.dataset[key];
  else document.documentElement.dataset[key] = preference;
  try {
    localStorage.setItem(key, preference);
  } catch (err) {
    if (!(err instanceof DOMException)) throw err;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useFontPreference(slot: FontSlot): FontPreference {
  return useSyncExternalStore(subscribe, () => readFontPreference(slot));
}

export function readAppearance(): Appearance {
  return { theme: readThemePreference(), displayFont: readFontPreference("display"), textFont: readFontPreference("text") };
}

export function applyAppearance(patch: Partial<Appearance>): void {
  if (patch.theme) applyThemePreference(patch.theme);
  if (patch.displayFont) applyFontPreference("display", patch.displayFont);
  if (patch.textFont) applyFontPreference("text", patch.textFont);
}

export function followAppearanceFromOtherTabs(): () => void {
  function onStorage(event: StorageEvent) {
    if (event.key === STORAGE_KEY) applyThemePreference(readThemePreference());
    if (event.key === FONT_KEYS.display) applyFontPreference("display", readFontPreference("display"));
    if (event.key === FONT_KEYS.text) applyFontPreference("text", readFontPreference("text"));
  }
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
