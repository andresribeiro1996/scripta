import type { Locale } from "./locale.js";

export function decimalText(value: number, locale: Locale, digits?: number): string {
  const text = digits === undefined ? String(value) : value.toFixed(digits);
  return locale === "pt-PT" ? text.replace(".", ",") : text;
}
