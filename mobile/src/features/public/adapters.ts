import { bookKey, ensureBookBlockHeights, type Mural, type ResolvedTierlist } from "@scripta/shared";
import type { CommunityProfileView } from "@scripta/shared/community";
import type { GalleryImage } from "../gallery/api";
import type { Tierlist } from "../tierlists/api";
import type { PublicBookData, PublicHighlight } from "./api";

function privateBook(book: PublicBookData): Record<string, unknown> {
  return { Title: book.title, Attribution: book.author, ISBN: book.isbn, ImageId: book.imageId, _coverUrl: book.coverUrl, ReadStatus: book.readStatus, _key: book.key, _workId: book.workId ?? undefined, highlights: [] };
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
  return Object.entries(tierlists).map(([id, tierlist]) => ({ id, name: tierlist.name, data: { tiers: tierlist.tiers, pool: tierlist.pool }, createdAt: "", updatedAt: "", voteCode: null, voteAccess: "anonymous", votingOpen: false, sourceTierlistId: null, promotedAt: null, originCreatorId: "", ranksWorstFirst: false, subject: null }));
}

export function muralPreviewOf(payload: NonNullable<CommunityProfileView["mural"]>) {
  const mural: Mural = { ...payload.mural, blocks: ensureBookBlockHeights(payload.mural.blocks), coverImageUrl: payload.mural.coverImageUrl ?? undefined, createdAt: "", updatedAt: "", shareToken: null, shareUrl: null, folderId: null };
  const images: GalleryImage[] = Object.entries(payload.imageUrls).flatMap(([id, url]) => url ? [{ id, url, filename: "", mimeType: "", width: 0, height: 0, byteSize: 0, createdAt: "" }] : []);
  return { mural, images, books: reconstructBooks(payload.library.books, payload.library.currentlyReading, payload.library.highlights), tierlists: reconstructTierlists(payload.tierlists) };
}
