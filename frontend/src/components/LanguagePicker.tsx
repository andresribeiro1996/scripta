import { useState, useSyncExternalStore } from "react";
import type { LocalePreference } from "@scripta/shared/i18n";
import { isAppearanceSyncFailure, saveAccountAppearance } from "../api/appearance";
import { PORTUGUESE_ENABLED, getLocalePreference, setLocalePreference, subscribeLocale, useT } from "../i18n";

const OPTIONS: LocalePreference[] = ["auto", "en", "pt-PT"];

export function LanguagePicker() {
  const selected = useSyncExternalStore(subscribeLocale, getLocalePreference, getLocalePreference);
  const t = useT();
  const [error, setError] = useState<string | null>(null);

  if (!PORTUGUESE_ENABLED) return null;

  const labels: Record<LocalePreference, string> = { auto: t("settings.languageAuto"), en: "English", "pt-PT": "Português" };

  async function choose(preference: LocalePreference) {
    setLocalePreference(preference);
    setError(null);
    try {
      await saveAccountAppearance({ locale: preference });
    } catch (err) {
      if (!isAppearanceSyncFailure(err)) throw err;
      setError(t("settings.languageSaveFailed"));
    }
  }

  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold text-(--color-text-dim)">{t("settings.language")}</legend>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((option) => (
          <label key={option} className="cursor-pointer">
            <input type="radio" name="language" value={option} checked={selected === option} onClick={() => void choose(option)} readOnly className="peer sr-only" />
            <span className="block rounded-lg border border-(--color-border) px-3 py-1.5 text-sm peer-checked:border-(--color-accent) peer-checked:ring-1 peer-checked:ring-(--color-accent) peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-(--color-accent)">
              {labels[option]}
            </span>
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-(--color-danger)">
          {error}
        </p>
      )}
    </fieldset>
  );
}
