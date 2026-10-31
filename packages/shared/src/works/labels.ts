import type { Locale } from "../i18n/locale.js";
import { sharedT } from "../i18n/sharedT.js";
import { statusLabel } from "../library/covers.js";
import type { ReaderProfile } from "../murals/murals.js";
import type { WorkEdition, WorkReadStatus } from "./types.js";

export function readerStatusLabel(status: WorkReadStatus, locale: Locale): string {
  if (status === 0) return sharedT(locale)("shared.works.readerWants");
  return statusLabel(status, locale);
}

export function readerCountsLabel(counts: { readers: number; finished: number }, locale: Locale): string {
  const t = sharedT(locale);
  if (counts.readers === 0) return t("shared.works.noReaders");
  const readers = t("shared.works.readers", { count: counts.readers });
  return counts.finished > 0 ? t("shared.works.readersFinished", { readers, finished: counts.finished }) : readers;
}

export function gameOwnerLabel(owner: ReaderProfile | "app"): string {
  return owner === "app" ? "Atmyshelf" : owner.username;
}

export function editionLabel(edition: WorkEdition, locale: Locale): string {
  const parts = [edition.language, edition.year === null ? null : String(edition.year), edition.isbn].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : sharedT(locale)("shared.works.editionUnknown");
}

const SUMMARY_PREVIEW_LENGTH = 320;

export function summaryPreview(summary: string): string | null {
  return summary.length > SUMMARY_PREVIEW_LENGTH ? `${summary.slice(0, SUMMARY_PREVIEW_LENGTH).replace(/\s+\S*$/, "")}…` : null;
}
