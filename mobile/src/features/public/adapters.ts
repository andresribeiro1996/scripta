import { bookKey, type ResolvedTierlist } from "@scripta/shared";
import type { Tierlist } from "../tierlists/api";
import type { PublicBookData, PublicHighlight } from "./api";

function privateBook(book: PublicBookData): Record<string, unknown> {
  return { Title: book.title, Attribution: book.author, ISBN: book.isbn, ImageId: book.imageId, _coverUrl: book.coverUrl, ReadStatus: book.readStatus, highlights: [] };
}

export function reconstructBooks(books: PublicBookData[], reading: PublicBookData[], highlights: PublicHighlight[]) {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const source of [...books, ...reading]) {
    const book = privateBook(source);
    const key = bookKey(book);
    if (!byKey.has(key)) byKey.set(key, book);
  }
  for (const highlight of highlights) {
    const book = byKey.get(highlight.bookKey);
    if (book) (book.highlights as Array<Record<string, unknown>>).push({ BookmarkID: highlight.highlightId, Text: highlight.text, Annotation: highlight.annotation });
  }
  return [...byKey.values()];
}

export function reconstructTierlists(tierlists: Record<string, ResolvedTierlist>): Tierlist[] {
  return Object.entries(tierlists).map(([id, tierlist]) => ({ id, name: tierlist.name, data: { tiers: tierlist.tiers, pool: tierlist.pool }, createdAt: "", updatedAt: "", voteCode: null, voteAccess: "anonymous", votingOpen: false, sourceTierlistId: null }));
}
