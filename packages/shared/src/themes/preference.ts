import { THEME_IDS, type ThemeId, type ThemeScheme } from "./palettes.js";

export type ThemePreference = ThemeId | "system";

export const THEME_PREFERENCES = ["system", ...THEME_IDS] as const;

export function parseThemePreference(value: unknown): ThemePreference {
  return typeof value === "string" && (THEME_PREFERENCES as readonly string[]).includes(value) ? (value as ThemePreference) : "system";
}

export function resolveTheme(preference: ThemePreference, osScheme: ThemeScheme): ThemeId {
  return preference === "system" ? osScheme : preference;
}

export function reconcileThemePreference(
  account: ThemePreference | null,
  device: ThemePreference,
): { apply: ThemePreference | null; upload: ThemePreference | null } {
  if (account === null) return { apply: null, upload: device };
  if (account === device) return { apply: null, upload: null };
  return { apply: account, upload: null };
}
