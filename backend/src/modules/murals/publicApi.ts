import type { TierlistData } from "../tierlists/index.js";
import type { MuralsRepository } from "./domain/ports.js";
import { resolveMuralPublicPayload, type MuralPublicPayload } from "./domain/publicPayload.js";

export interface MuralsPublicApi {
  ownsMural(userId: string, muralId: string): boolean;
  getMuralPublicPayload(userId: string, muralId: string): MuralPublicPayload | null;
}

export function createMuralsPublicApi(
  repo: MuralsRepository,
  getTierlistData?: (ownerUserId: string, tierlistId: string) => TierlistData | undefined
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
    }
  };
}
