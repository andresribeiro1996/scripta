import { useState } from "react";
import { DISPLAY_FONT_IDS, TEXT_FONT_IDS, fontStack, fonts, resolveFonts, resolveTheme, type FontPreference, type FontSlot } from "@scripta/shared/themes";
import { isAppearanceSyncFailure, saveAccountAppearance } from "../api/appearance";
import { applyFontPreference, osScheme, useFontPreference, useThemePreference } from "../lib/theme";

export function FontPicker({ slot }: { slot: FontSlot }) {
  const selected = useFontPreference(slot);
  const themeDefault = resolveFonts(resolveTheme(useThemePreference(), osScheme()), "theme", "theme")[slot];
  const [error, setError] = useState<string | null>(null);
  const options: FontPreference[] = ["theme", ...(slot === "display" ? DISPLAY_FONT_IDS : TEXT_FONT_IDS)];

  async function choose(preference: FontPreference) {
    applyFontPreference(slot, preference);
    setError(null);
    try {
      await saveAccountAppearance(slot === "display" ? { displayFont: preference } : { textFont: preference });
    } catch (err) {
      if (!isAppearanceSyncFailure(err)) throw err;
      setError("Couldn't save to your account. Try again.");
    }
  }

  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold text-(--color-text-dim)">{slot === "display" ? "Headings" : "Text"}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const shown = option === "theme" ? themeDefault : option;
          return (
            <label key={option} className="cursor-pointer">
              <input type="radio" name={`font-${slot}`} value={option} checked={selected === option} onClick={() => void choose(option)} readOnly className="peer sr-only" />
              <span
                className="block rounded-lg border border-(--color-border) px-3 py-1.5 text-sm peer-checked:border-(--color-accent) peer-checked:ring-1 peer-checked:ring-(--color-accent) peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-(--color-accent)"
                style={{ fontFamily: fontStack(shown), fontWeight: slot === "display" ? 700 : undefined }}
              >
                {option === "theme" ? `Theme default · ${fonts[themeDefault].label}` : fonts[option].label}
              </span>
            </label>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-(--color-danger)">
          {error}
        </p>
      )}
    </fieldset>
  );
}
