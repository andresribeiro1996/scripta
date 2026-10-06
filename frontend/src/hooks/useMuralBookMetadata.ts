import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ResolvedTierlist } from "../api/tierlists";
import { bookMetadataOptions } from "../lib/bookMetadata";
import { blockBooks, type MuralBlock } from "../lib/murals";

export function muralMetadataBooks(
  blocks: MuralBlock[],
  books: Array<Record<string, unknown>>,
  tierlistData?: (id: string) => ResolvedTierlist | undefined
) {
  return [...new Set(blocks.flatMap((block) => blockBooks(block, books, tierlistData)))];
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
