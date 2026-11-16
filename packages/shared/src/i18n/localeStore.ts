import { resolveLocale, type Locale, type LocalePreference } from "./locale.js";

export function createLocaleStore(portugueseEnabled: boolean) {
  let preference: LocalePreference = "auto";
  let deviceTags: readonly string[] = [];
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  return {
    getLocalePreference(): LocalePreference {
      return preference;
    },
    setLocalePreference(next: LocalePreference): void {
      if (next === preference) return;
      preference = next;
      notify();
    },
    setDeviceLocaleTags(tags: readonly string[]): void {
      deviceTags = tags;
      notify();
    },
    subscribeLocale(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getLocale(): Locale {
      const resolved = resolveLocale(preference, deviceTags);
      return portugueseEnabled && preference === "pt-PT" ? resolved : "en";
    },
  };
}
