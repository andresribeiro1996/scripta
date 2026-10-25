import { PRIZES, bookKey, isPrizeKey, type AwardAnnouncement, type LibraryDocument } from "@scripta/shared";

export type AwardCardModel = {
  key: string;
  title: string;
  subtitle: string;
  shelfLine: string | null;
  coverUrl: string | null;
  target: { kind: "work"; id: string } | { kind: "search"; query: string };
};

const SHELF_LINES = ["On your to-read shelf", "You're reading it", "You've read it"] as const;

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

export function awardCardModel(announcement: AwardAnnouncement, library: LibraryDocument | null): AwardCardModel | null {
  if (!isPrizeKey(announcement.prize)) return null;
  const held = heldStatuses(library);
  const title = `${PRIZES[announcement.prize].label} ${announcement.year}`;
  const key = awardKey(announcement);
  if (announcement.honoree) {
    const { name, workIds } = announcement.honoree;
    const books = workIds.filter((id) => held.has(id)).length;
    return { key, title, subtitle: name, shelfLine: books === 0 ? null : `${books} of their books in your library`, coverUrl: null, target: { kind: "search", query: name } };
  }
  const [first, ...rest] = announcement.winners;
  if (!first) return null;
  const status = held.get(first.workId);
  const nominees = announcement.nomineeWorkIds.filter((id) => held.has(id)).length;
  return {
    key,
    title,
    subtitle: `${first.title} · ${first.author}${rest.length > 0 ? ` and ${rest.length} more` : ""}`,
    shelfLine: status !== undefined ? SHELF_LINES[status] : nominees === 0 ? null : `${nominees} ${nominees === 1 ? "nominee" : "nominees"} in your library`,
    coverUrl: first.coverUrl,
    target: { kind: "work", id: first.workId },
  };
}

export function firstUndismissed(announcements: readonly AwardAnnouncement[], dismissed: ReadonlySet<string>): AwardAnnouncement | undefined {
  return announcements.find((announcement) => isPrizeKey(announcement.prize) && !dismissed.has(awardKey(announcement)));
}
