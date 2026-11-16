import type { LibraryBook } from "@scripta/shared";
import { readingNow, type DiscoverItem, type PublishedContent } from "@scripta/shared/community";
import type { Locale } from "@scripta/shared/i18n";
import { translatorFor } from "../../i18n";
import { contentKindLabel, contentStats, contentTarget } from "../community/communityHome";

export const gamesBrowseHref = (nonce: number) => ({ pathname: "/my-arena", params: { pane: "browse", t: String(nonce) } });

export type NewGameRow = { key: string; content: PublishedContent; kind: string; name: string; meta: string; target: string };

export const currentRead = (books: LibraryBook[] | undefined): LibraryBook | null => readingNow(books)[0] ?? null;

export function newGameRows(items: DiscoverItem[], locale: Locale, viewerId: string | null): NewGameRow[] {
  const t = translatorFor(locale);
  return items.filter(({ author }) => author.userId !== viewerId).slice(0, 2).map(({ author, content }) => {
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
