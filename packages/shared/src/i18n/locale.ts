export const LOCALES = ["en", "pt-PT"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_PREFERENCES = ["auto", "en", "pt-PT"] as const;
export type LocalePreference = (typeof LOCALE_PREFERENCES)[number];

export function parseLocalePreference(value: unknown): LocalePreference {
  return LOCALE_PREFERENCES.find((preference) => preference === value) ?? "auto";
}

export function resolveLocale(
  preference: LocalePreference | null | undefined,
  deviceTags: readonly string[],
): Locale {
  if (preference === "en" || preference === "pt-PT") return preference;
  return /^pt([-_]|$)/i.test(deviceTags[0] ?? "") ? "pt-PT" : "en";
}

export function parseAcceptLanguage(header: string | undefined): string[] {
  const entries: { tag: string; q: number }[] = [];
  for (const part of (header ?? "").split(",")) {
    const [tag = "", ...params] = part.split(";").map((piece) => piece.trim());
    if (!/^[A-Za-z]{1,8}([-_][A-Za-z0-9]{1,8})*$/.test(tag)) continue;
    const qParam = params.find((param) => /^q=/i.test(param));
    const q = qParam ? Number(qParam.slice(2)) : 1;
    if (Number.isNaN(q)) continue;
    entries.push({ tag, q });
  }
  return entries.sort((a, b) => b.q - a.q).map((entry) => entry.tag);
}

export function intlLocale(locale: Locale): string | undefined {
  return locale === "pt-PT" ? "pt-PT" : undefined;
}
