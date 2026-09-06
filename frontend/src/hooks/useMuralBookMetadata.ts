import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ResolvedTierlist } from "../api/tierlists";
import { bookMetadataOptions } from "../lib/bookMetadata";
import { bookKey } from "../lib/merge";
import type { MuralBlock } from "../lib/murals";

export function muralMetadataBooks(
  blocks: MuralBlock[],
  books: Array<Record<string, unknown>>,
  tierlistData?: (id: string) => ResolvedTierlist | undefined
) {
  const keys = new Set<string>();
  for (const block of blocks) {
    if (block.type === "spotlight") keys.add(block.bookKey);
    if (block.type === "shelf") block.bookKeys.forEach((key) => keys.add(key));
    if (block.type === "currentlyReading") books.filter((book) => book.ReadStatus === 1).forEach((book) => keys.add(bookKey(book)));
    if (block.type === "tierlist") {
      const tierlist = tierlistData?.(block.tierlistId);
      tierlist?.tiers.forEach((tier) => tier.bookKeys.forEach((key) => keys.add(key)));
      tierlist?.pool.forEach((key) => keys.add(key));
    }
  }
  const byKey = new Map(books.map((book) => [bookKey(book), book]));
  return [...keys].flatMap((key) => {
    const book = byKey.get(key);
    return book ? [book] : [];
  });
}

export function useMuralBookMetadata(
  blocks: MuralBlock[],
  books: Array<Record<string, unknown>>,
  tierlistData?: (id: string) => ResolvedTierlist | undefined
) {
  const client = useQueryClient();
  const metadataBooks = JSON.stringify(muralMetadataBooks(blocks, books, tierlistData).map((book) => ({
    ISBN: book.ISBN,
    Title: book.Title,
    Attribution: book.Attribution
  })));
  useEffect(() => {
    let stopped = false;
    async function preload() {
      for (const book of JSON.parse(metadataBooks) as Array<Record<string, unknown>>) {
        if (stopped) break;
        await client.prefetchQuery(bookMetadataOptions(book));
      }
    }
    void preload();
    return () => { stopped = true; };
  }, [client, metadataBooks]);
}
