import { bookKey } from "../library/merge.js";
import type { Group } from "../library/groups.js";
import { resolveQuote, type MuralBlock } from "./murals.js";

export function isEligiblePassage(highlight: unknown): highlight is Record<string, unknown> {
  if (!highlight || typeof highlight !== "object") return false;
  const { Type, Text, BookmarkID } = highlight as Record<string, unknown>;
  return Type === "highlight" && typeof Text === "string" && Text.trim() !== "" && typeof BookmarkID === "string" && BookmarkID.trim() !== "";
}

export function eligiblePassages(books: Array<Record<string, unknown>>) {
  return books.flatMap((book) => (Array.isArray(book.highlights) ? book.highlights : [])
    .filter(isEligiblePassage)
    .map((highlight) => ({ bookKey: bookKey(book), highlightId: String(highlight.BookmarkID) })))
    .sort((a, b) => `${a.bookKey}:${a.highlightId}`.localeCompare(`${b.bookKey}:${b.highlightId}`));
}

export function rediscoverPassage(blockId: string, books: Array<Record<string, unknown>>, day: string, offset = 0) {
  const candidates = eligiblePassages(books);
  let hash = 0;
  for (const char of `${day}:${blockId}`) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return candidates.length ? candidates[(hash + offset) % candidates.length] : undefined;
}

export function resolveHomeBlock(block: MuralBlock, books: Array<Record<string, unknown>>, groups: Group[], day: string, offset = 0): MuralBlock {
  if (block.type === "shelf" && block.collectionId) {
    const collection = groups.find((group) => group.type === "collection" && group.id === block.collectionId);
    return { ...block, collectionId: undefined, title: block.title || collection?.name || "Collection unavailable — reconnect in Edit", bookKeys: collection?.bookKeys ?? [] };
  }
  if (block.type === "quote" && block.mode === "rediscover") {
    const ref = rediscoverPassage(block.id, books, day, offset);
    return { ...block, mode: undefined, bookKey: ref?.bookKey ?? "", highlightId: ref?.highlightId ?? "" };
  }
  return block;
}

export function pinPassage(block: MuralBlock, resolved: MuralBlock, books: Array<Record<string, unknown>>): MuralBlock {
  if (block.type !== "quote" || resolved.type !== "quote" || !resolveQuote(resolved, books)) return block;
  return { ...block, mode: undefined, bookKey: resolved.bookKey, highlightId: resolved.highlightId };
}

