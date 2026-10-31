import type { Locale } from "../i18n/locale.js";
import { sharedT } from "../i18n/sharedT.js";

export function saveFailureMessage(error: unknown, generic: string, locale: Locale): string {
  if (!(error instanceof Error) || !("status" in error)) return generic;
  if (error.status === 413) return error.message || generic;
  if (error.status === 429) return sharedT(locale)("shared.saveFailure.tooMany");
  return generic;
}
