import type { Locale } from "@scripta/shared/i18n";
import { t } from "../../../i18n/index.js";

const BYTES_PER_MB = 1024 * 1024;

function wholeMegabytes(bytes: number): number {
  return Math.floor(bytes / BYTES_PER_MB);
}

export function libraryTooLargeMessage(locale: Locale, maxBytes: number): string {
  return t(locale, "library.tooLarge", { mb: wholeMegabytes(maxBytes) });
}

export function importTooLargeMessage(locale: Locale, maxBytes: number): string {
  return t(locale, "library.importOverLimit", { mb: wholeMegabytes(maxBytes) });
}
