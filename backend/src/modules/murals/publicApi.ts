import { muralThemeId, type ResolvedTierlist } from "@scripta/shared";
import type { MuralsRepository } from "./domain/ports.js";
import { muralCoverImageUrl, resolveMuralPublicPayload, type MuralPublicPayload } from "./domain/publicPayload.js";

export type MuralSummary = Pick<MuralPublicPayload["mural"], "id" | "name" | "theme" | "coverImageUrl">;

export interface MuralsPublicApi {
  ownsMural(userId: string, muralId: string): boolean;
  getMuralPublicPayload(userId: string, muralId: string): MuralPublicPayload | null;
  getMuralSummary(userId: string, muralId: string): MuralSummary | null;
}

export function createMuralsPublicApi(
  repo: MuralsRepository,
  getTierlistData?: (ownerUserId: string, tierlistId: string) => ResolvedTierlist | undefined
): MuralsPublicApi {
  return {
    ownsMural(userId, muralId) {
      return repo.getOwned(muralId, userId) !== undefined;
    },
    getMuralPublicPayload(userId, muralId) {
      const row = repo.getOwned(muralId, userId);
      if (!row) return null;
      let blocks: unknown;
      try {
        blocks = JSON.parse(row.blocks);
      } catch {
        return null;
      }
      return resolveMuralPublicPayload(row, blocks, getTierlistData);
    },
    getMuralSummary(userId, muralId) {
      const row = repo.getOwned(muralId, userId);
      return row ? { id: row.id, name: row.name, theme: muralThemeId(row.theme), coverImageUrl: muralCoverImageUrl(row) } : null;
    }
  };
}
