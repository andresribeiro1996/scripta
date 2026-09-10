import { bookKey } from "../library/merge.js";
import type { Group } from "../library/groups.js";
import { newId, resolveQuote, type MuralBlock } from "./murals.js";

export function eligiblePassages(books: Array<Record<string, unknown>>) {
  return books.flatMap((book) => (Array.isArray(book.highlights) ? book.highlights : [])
    .filter((highlight): highlight is Record<string, unknown> => Boolean(highlight && typeof highlight === "object" &&
      highlight.Type === "highlight" && typeof highlight.Text === "string" && highlight.Text.trim() &&
      typeof highlight.BookmarkID === "string" && highlight.BookmarkID.trim()))
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

export function buildHomeBlocks(withPassage: boolean): MuralBlock[] {
  const blocks: MuralBlock[] = [
    { id: newId(), type: "text", heading: "My reading space", body: "", layout: { x: 0, y: 0, w: 12, h: 3 } },
    { id: newId(), type: "currentlyReading", layout: { x: 0, y: 4, w: 12, h: 8 } },
    { id: newId(), type: "shelf", title: "Up next", bookKeys: [], layout: { x: 0, y: 13, w: 12, h: 7 } }
  ];
  if (withPassage) blocks.push({ id: newId(), type: "quote", mode: "rediscover", bookKey: "", highlightId: "", layout: { x: 0, y: 21, w: 12, h: 7 } });
  return blocks;
}
