import { THEME_IDS, themes, type ThemeId, type ThemeScheme } from "./palettes.js";
import { DISPLAY_FONT_IDS, TEXT_FONT_IDS, fonts, type FontId, type FontSlot } from "./fonts.js";

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

export type FontPreference = FontId | "theme";

export const DISPLAY_FONT_PREFERENCES = ["theme", ...DISPLAY_FONT_IDS] as const;

export const TEXT_FONT_PREFERENCES = ["theme", ...TEXT_FONT_IDS] as const;

export interface Appearance {
  theme: ThemePreference;
  displayFont: FontPreference;
  textFont: FontPreference;
}

export type AccountAppearance = { [K in keyof Appearance]: Appearance[K] | null };

export function parseFontPreference(slot: FontSlot, value: unknown): FontPreference {
  const allowed: readonly string[] = slot === "display" ? DISPLAY_FONT_PREFERENCES : TEXT_FONT_PREFERENCES;
  return typeof value === "string" && allowed.includes(value) ? (value as FontPreference) : "theme";
}

function nullable<T>(value: unknown, parse: (raw: unknown) => T): T | null {
  return value === null || value === undefined ? null : parse(value);
}

export function parseAccountAppearance(value: unknown): AccountAppearance {
  const body = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    theme: nullable(body.theme, parseThemePreference),
    displayFont: nullable(body.displayFont, (raw) => parseFontPreference("display", raw)),
    textFont: nullable(body.textFont, (raw) => parseFontPreference("text", raw)),
  };
}

export function resolveFonts(themeId: ThemeId, displayFont: FontPreference, textFont: FontPreference): { display: FontId; text: FontId } {
  const pick = (slot: FontSlot, preference: FontPreference): FontId =>
    preference !== "theme" && fonts[preference].slots.includes(slot) ? preference : themes[themeId].fonts[slot];
  return { display: pick("display", displayFont), text: pick("text", textFont) };
}

function reconcileField<K extends keyof Appearance>(key: K, account: AccountAppearance, device: Appearance, apply: Partial<Appearance>, upload: Partial<Appearance>): void {
  const value = account[key];
  if (value === null) upload[key] = device[key];
  else if (value !== device[key]) apply[key] = value as Appearance[K];
}

export function reconcileAppearance(account: AccountAppearance, device: Appearance): { apply: Partial<Appearance>; upload: Partial<Appearance> } {
  const apply: Partial<Appearance> = {};
  const upload: Partial<Appearance> = {};
  reconcileField("theme", account, device, apply, upload);
  reconcileField("displayFont", account, device, apply, upload);
  reconcileField("textFont", account, device, apply, upload);
  return { apply, upload };
}
