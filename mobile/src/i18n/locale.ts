import { resolveLocale, type Locale, type LocalePreference } from "@scripta/shared/i18n";
import { PORTUGUESE_ENABLED } from "./flag";

let preference: LocalePreference = "auto";
let deviceTags: readonly string[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function getLocalePreference(): LocalePreference {
  return preference;
}

export function setLocalePreference(next: LocalePreference): void {
  if (next === preference) return;
  preference = next;
  notify();
}

export function setDeviceLocaleTags(tags: readonly string[]): void {
  deviceTags = tags;
  notify();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLocale(): Locale {
  const resolved = resolveLocale(preference, deviceTags);
  return PORTUGUESE_ENABLED && preference === "pt-PT" ? resolved : "en";
}
