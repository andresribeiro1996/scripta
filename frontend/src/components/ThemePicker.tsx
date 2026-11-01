import { useState } from "react";
import { THEME_IDS, type ThemePreference } from "@scripta/shared/themes";
import { isAppearanceSyncFailure, saveAccountAppearance } from "../api/appearance";
import { fadeToThemePreference, useThemePreference } from "../lib/theme";
import { ThemeOptionGrid } from "./ThemeOptionGrid";
import { useT } from "../i18n";

const OPTIONS: ThemePreference[] = ["system", ...THEME_IDS];

export function ThemePicker() {
  const t = useT();
  const selected = useThemePreference();
  const [error, setError] = useState<string | null>(null);

  async function choose(preference: ThemePreference) {
    fadeToThemePreference(preference);
    setError(null);
    try {
      await saveAccountAppearance({ theme: preference });
    } catch (err) {
      if (!isAppearanceSyncFailure(err)) throw err;
      setError(t("settings.languageSaveFailed"));
    }
  }

  return (
    <>
      <ThemeOptionGrid options={OPTIONS} value={selected} onChange={(option) => void choose(option)} />
      {error && (
        <p role="alert" className="mt-3 text-xs text-(--color-danger)">
          {error}
        </p>
      )}
    </>
  );
}
