import { useState } from "react";
import { THEME_IDS, themes, type ThemeColors, type ThemePreference } from "@scripta/shared/themes";
import { isThemeSyncFailure, saveAccountTheme } from "../api/theme";
import { applyThemePreference, useThemePreference } from "../lib/theme";

const OPTIONS: ThemePreference[] = ["system", ...THEME_IDS];

function Swatch({ colors }: { colors: ThemeColors }) {
  return (
    <div className="flex flex-1 p-1.5" style={{ background: colors.background }}>
      <div className="flex flex-1 flex-col justify-between rounded p-1.5" style={{ background: colors.surface, border: `1px solid ${colors.border}` }}>
        <div className="h-1.5 w-3/4 rounded-full" style={{ background: colors.text }} />
        <div className="h-1.5 w-1/2 rounded-full" style={{ background: colors.textDim }} />
        <div className="h-2.5 rounded" style={{ background: colors.accent }} />
      </div>
    </div>
  );
}

export function ThemePicker() {
  const selected = useThemePreference();
  const [error, setError] = useState<string | null>(null);

  async function choose(preference: ThemePreference) {
    applyThemePreference(preference);
    setError(null);
    try {
      await saveAccountTheme(preference);
    } catch (err) {
      if (!isThemeSyncFailure(err)) throw err;
      setError("Couldn't save to your account. Try again.");
    }
  }

  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {OPTIONS.map((option) => (
          <label key={option} className="cursor-pointer">
            <input
              type="radio"
              name="theme"
              value={option}
              checked={selected === option}
              onClick={() => void choose(option)}
              readOnly
              className="peer sr-only"
            />
            <div className="flex h-16 overflow-hidden rounded-lg border border-(--color-border) peer-checked:ring-2 peer-checked:ring-(--color-accent) peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-(--color-accent)">
              {option === "system" ? (
                <>
                  <Swatch colors={themes.light.colors} />
                  <Swatch colors={themes.dark.colors} />
                </>
              ) : (
                <Swatch colors={themes[option].colors} />
              )}
            </div>
            <span className="mt-1.5 block text-center text-xs">{option === "system" ? "System" : themes[option].label}</span>
          </label>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-xs text-(--color-danger)">
          {error}
        </p>
      )}
    </fieldset>
  );
}
