import { bookKey } from "../library/merge.js";
import type { LibraryDocument } from "../library/types.js";
import type { Locale } from "../i18n/locale.js";
import { sharedT } from "../i18n/sharedT.js";
import { isPrizeKey, prizeLabel } from "./awards.js";
import type { AwardAnnouncement } from "./types.js";

export type AwardCardModel = {
  key: string;
  title: string;
  subtitle: string;
  shelfLine: string | null;
  coverUrl: string | null;
  target: { kind: "work"; id: string } | { kind: "search"; query: string };
};

const SHELF_LINES = ["shared.awards.shelfToRead", "shared.awards.shelfReading", "shared.awards.shelfRead"] as const;

export function awardKey(announcement: Pick<AwardAnnouncement, "prize" | "year">): string {
  return `awardDismissed:${announcement.prize}:${announcement.year}`;
}

function heldStatuses(library: LibraryDocument | null): Map<string, 0 | 1 | 2> {
  const held = new Map<string, 0 | 1 | 2>();
  for (const book of library?.data.books ?? []) {
    const workId = library?.works?.[bookKey(book)];
    if (!workId) continue;
    const status = book.ReadStatus === 1 || book.ReadStatus === 2 ? book.ReadStatus : 0;
    if (status >= (held.get(workId) ?? 0)) held.set(workId, status);
  }
  return held;
}

export function awardCardModel(announcement: AwardAnnouncement, library: LibraryDocument | null, locale: Locale): AwardCardModel | null {
  if (!isPrizeKey(announcement.prize)) return null;
  const t = sharedT(locale);
  const held = heldStatuses(library);
  const title = `${prizeLabel(announcement.prize, locale)} ${announcement.year}`;
  const key = awardKey(announcement);
  if (announcement.honoree) {
    const { name, workIds } = announcement.honoree;
    const books = workIds.filter((id) => held.has(id)).length;
    return { key, title, subtitle: name, shelfLine: books === 0 ? null : t("shared.awards.honoreeBooks", { count: books }), coverUrl: null, target: { kind: "search", query: name } };
  }
  const [first, ...rest] = announcement.winners;
  if (!first) return null;
  const status = held.get(first.workId);
  const nominees = announcement.nomineeWorkIds.filter((id) => held.has(id)).length;
  return {
    key,
    title,
    subtitle: rest.length > 0 ? t("shared.awards.winnerMore", { title: first.title, author: first.author, count: rest.length }) : `${first.title} · ${first.author}`,
    shelfLine: status !== undefined ? t(SHELF_LINES[status]) : nominees === 0 ? null : t("shared.awards.nominees", { count: nominees }),
    coverUrl: first.coverUrl,
    target: { kind: "work", id: first.workId },
  };
}

export function firstUndismissed(announcements: readonly AwardAnnouncement[], dismissed: ReadonlySet<string>): AwardAnnouncement | undefined {
  return announcements.find((announcement) => isPrizeKey(announcement.prize) && !dismissed.has(awardKey(announcement)));
}
