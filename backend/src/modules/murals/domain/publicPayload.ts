import type { ReaderProfile } from "@scripta/shared";
import { env } from "../../../config/env.js";
import { resolvePublicReaderProfile } from "../../auth/index.js";
import { resolvePublicLibraryData } from "../../library/index.js";
import type { TierlistData } from "../../tierlists/index.js";
import { extractReferences } from "./blockRefs.js";
import type { MuralRow } from "./types.js";

type PublicLibraryData = ReturnType<typeof resolvePublicLibraryData>;

export interface MuralPublicPayload {
  mural: { id: string; name: string; blocks: unknown[]; coverImageUrl: string | null };
  library: PublicLibraryData;
  profile: ReaderProfile | undefined;
  imageUrls: Record<string, string | null>;
  tierlists: Record<string, TierlistData>;
}

export function resolveMuralPublicPayload(
  row: MuralRow,
  blocks: unknown,
  getTierlistData?: (ownerUserId: string, tierlistId: string) => TierlistData | undefined
): MuralPublicPayload {
  const refs = extractReferences(blocks);

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
      .filter((entry): entry is readonly [string, TierlistData] => entry[1] !== undefined)
  );
  const tierlistBookKeys = new Set<string>();
  for (const tierlist of Object.values(tierlists)) {
    for (const key of tierlist.pool) tierlistBookKeys.add(key);
    for (const tier of tierlist.tiers) for (const key of tier.bookKeys) tierlistBookKeys.add(key);
  }

  const libraryData = resolvePublicLibraryData(row.user_id, {
    bookKeys: [...refs.bookKeys, ...tierlistBookKeys],
    collectionIds: [...refs.collectionIds],
    highlightRefs: refs.highlightRefs,
    needsCurrentlyReading: refs.needsCurrentlyReading,
    statsMetrics: [...refs.statsMetrics],
    needsShelfTheme: refs.needsShelfTheme
  });

  const imageIds = [...refs.imageIds, ...(row.cover_image_id ? [row.cover_image_id] : [])];
  const imageUrls = Object.fromEntries(imageIds.map((id) => [id, `${env.PUBLIC_API_URL}/gallery/${id}/file`]));

  return {
    mural: {
      id: row.id,
      name: row.name,
      blocks: (Array.isArray(blocks) ? blocks : []).map((block) => {
        if (!block || typeof block !== "object") return block;
        if (block.type === "quote" && block.mode === "rediscover") return { id: block.id, type: "text", layout: block.layout, style: block.style, heading: "Private passage", body: "Rediscovered passages are only visible to the owner." };
        if (block.type === "shelf" && typeof block.collectionId === "string") {
          const { collectionId, ...rest } = block;
          return { ...rest, bookKeys: libraryData.collectionBooks?.[collectionId] ?? [] };
        }
        return block;
      }),
      coverImageUrl: row.cover_image_id ? imageUrls[row.cover_image_id]! : row.cover_image_url
    },
    library: libraryData,
    profile: refs.needsShelfTheme ? resolvePublicReaderProfile(row.user_id) : undefined,
    imageUrls,
    tierlists
  };
}
