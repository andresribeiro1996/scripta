import { parseBookDate, type LibraryBook } from "@scripta/shared";
import type { DiscoverItem, PublishedContent } from "@scripta/shared/community";
import type { Locale } from "@scripta/shared/i18n";
import { translatorFor } from "../../i18n";
import { contentKindLabel, contentStats, contentTarget } from "../community/communityHome";

export const gamesBrowseHref = (nonce: number) => ({ pathname: "/my-arena", params: { pane: "browse", t: String(nonce) } });

export type NewGameRow = { key: string; content: PublishedContent; kind: string; name: string; meta: string; target: string };

export function currentRead(books: LibraryBook[] | undefined): LibraryBook | null {
  const time = (book: LibraryBook) => parseBookDate(book.DateLastRead)?.getTime() ?? -Infinity;
  const reading = (books ?? []).filter((book) => book.ReadStatus === 1);
  return [...reading].sort((a, b) => time(b) - time(a))[0] ?? null;
}

export function newGameRows(items: DiscoverItem[], locale: Locale): NewGameRow[] {
  const t = translatorFor(locale);
  return items.slice(0, 2).map(({ author, content }) => {
    const headline = contentStats(content, locale).at(-1)!;
    const by = author.unavailable ? author.username : t("community.homeGameBy", { username: author.username });
    return {
      key: `${content.kind}:${content.id}`,
      content,
      kind: contentKindLabel(content, locale),
      name: content.name,
      meta: `${by} · ${headline.value} ${headline.label}`,
      target: contentTarget(content)
    };
  });
}
