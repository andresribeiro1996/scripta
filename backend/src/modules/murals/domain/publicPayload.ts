import { blockReferences, muralThemeId, type MuralBlock, type MuralPublicPayload, type ResolvedTierlist } from "@scripta/shared";
import { env } from "../../../config/env.js";
import { resolvePublicReaderProfile } from "../../auth/index.js";
import { resolvePublicBooksByWork, resolvePublicLibraryData } from "../../library/index.js";
import type { MuralRow } from "./types.js";

export type { MuralPublicPayload };

export function resolveMuralPublicPayload(
  row: MuralRow,
  blocks: unknown,
  getTierlistData?: (ownerUserId: string, tierlistId: string) => ResolvedTierlist | undefined
): MuralPublicPayload {
  const refs = blockReferences(blocks);

  const tierlistIds: string[] = [];
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      const candidate = block as { type?: unknown; tierlistId?: unknown };
      if (candidate.type !== "tierlist" || typeof candidate.tierlistId !== "string" || !candidate.tierlistId) continue;
      if (!tierlistIds.includes(candidate.tierlistId)) tierlistIds.push(candidate.tierlistId);
    }
  }
  const tierlists = Object.fromEntries(
    tierlistIds
      .map((id) => [id, getTierlistData?.(row.user_id, id)] as const)
      .filter((entry): entry is readonly [string, ResolvedTierlist] => entry[1] !== undefined)
  );
  const tierlistWorkIds = [...new Set(Object.values(tierlists).flatMap((tierlist) => [...tierlist.pool, ...tierlist.tiers.flatMap((tier) => tier.workIds)]))];

  const libraryData = resolvePublicLibraryData(row.user_id, {
    bookKeys: [...refs.bookKeys],
    collectionIds: [...refs.collectionIds],
    highlightRefs: refs.highlightRefs,
    needsCurrentlyReading: refs.needsCurrentlyReading,
    statsMetrics: [...refs.statsMetrics],
    needsShelfTheme: refs.needsShelfTheme,
    needsReaderCard: refs.needsReaderCard
  });

  if (tierlistWorkIds.length > 0) {
    const shown = new Set(libraryData.books.map((book) => book.key));
    for (const book of resolvePublicBooksByWork(row.user_id, tierlistWorkIds).values()) {
      if (shown.has(book.key)) continue;
      shown.add(book.key);
      libraryData.books.push(book);
    }
  }

  const imageIds = [...refs.imageIds, ...(row.cover_image_id ? [row.cover_image_id] : [])];
  const imageUrls = Object.fromEntries(imageIds.map((id) => [id, `${env.PUBLIC_API_URL}/gallery/${id}/file`]));

  return {
    mural: {
      id: row.id,
      name: row.name,
      theme: muralThemeId(row.theme),
      blocks: (Array.isArray(blocks) ? blocks : []).map((block) => {
        if (!block || typeof block !== "object") return block;
        if (block.type === "quote" && block.mode === "rediscover") return { id: block.id, type: "text", layout: block.layout, style: block.style, heading: "Private passage", body: "Rediscovered passages are only visible to the owner." };
        if (block.type === "shelf" && typeof block.collectionId === "string") {
          const { collectionId, ...rest } = block;
          return { ...rest, bookKeys: libraryData.collectionBooks?.[collectionId] ?? [] };
        }
        return block;
      }) as MuralBlock[],
      coverImageUrl: row.cover_image_id ? imageUrls[row.cover_image_id]! : row.cover_image_url
    },
    library: libraryData,
    profile: refs.needsShelfTheme || refs.needsReaderCard ? resolvePublicReaderProfile(row.user_id) : undefined,
    imageUrls,
    tierlists
  };
}
