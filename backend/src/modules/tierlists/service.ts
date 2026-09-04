// Business logic for the tierlists module. Depends only on the
// TierlistsRepository port, not on SQLite — same reasoning as every other
// module's service.ts.

import { randomUUID } from "node:crypto";
import type { TierlistsRepository } from "./domain/ports.js";
import type { Tierlist, TierlistRow } from "./domain/types.js";

function toTierlist(row: TierlistRow): Tierlist {
  // `data` is opaque, so nothing stops a row whose document predates a
  // field (or was hand-written) from missing tiers/pool — normalizing
  // HERE means every consumer (routes, the cross-module getter's
  // callers, the frontend editor) can trust the shape instead of each
  // one defending against `undefined.tiers` at its own read site.
  const parsed = JSON.parse(row.data) as { tiers?: unknown; pool?: unknown };
  return {
    id: row.id,
    name: row.name,
    data: { tiers: parsed.tiers ?? [], pool: parsed.pool ?? [] },
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export interface TierlistsService {
  listTierlists(userId: string): Tierlist[];
  createTierlist(userId: string, name: string): Tierlist;
  /** undefined if no tier list with that id is owned by userId — a
   *  caller-facing 404, not a server error. Same convention as
   *  modules/murals/service.ts's getMural. */
  getTierlist(userId: string, id: string): Tierlist | undefined;
  /** Partial merge onto the existing row — only the keys present in
   *  `patch` change. undefined if not owned. */
  updateTierlist(userId: string, id: string, patch: { name?: string; data?: unknown }): Tierlist | undefined;
  /** Returns false if no tier list with that id was owned by userId —
   *  same convention as modules/murals/service.ts's deleteMural. */
  deleteTierlist(userId: string, id: string): boolean;
}

/** Where a new tier list starts — the familiar S–D ladder, matching the
 *  preset the old mural-embedded tier list used to seed (down to the
 *  colors). Not a fixed scale: the editor can rename/recolor/reorder/
 *  delete every one of these and add more — this is just the starting
 *  point, so "New tier list" opens on a recognizable board instead of
 *  an empty one. */
const DEFAULT_TIER_PRESET: Array<{ label: string; color: string }> = [
  { label: "S", color: "#c9482f" },
  { label: "A", color: "#d98a3d" },
  { label: "B", color: "#c9a53d" },
  { label: "C", color: "#5c9e5c" },
  { label: "D", color: "#4a7fc9" }
];

export function createTierlistsService(repo: TierlistsRepository): TierlistsService {
  return {
    listTierlists(userId) {
      return repo.listByUser(userId).map(toTierlist);
    },

    createTierlist(userId, name) {
      const now = new Date().toISOString();
      const row: TierlistRow = {
        id: randomUUID(),
        owner_user_id: userId,
        name,
        data: JSON.stringify({
          tiers: DEFAULT_TIER_PRESET.map((t) => ({ id: randomUUID(), label: t.label, color: t.color, bookKeys: [] })),
          pool: []
        }),
        created_at: now,
        updated_at: now
      };
      repo.insert(row);
      return toTierlist(row);
    },

    getTierlist(userId, id) {
      const row = repo.getOwned(id, userId);
      return row ? toTierlist(row) : undefined;
    },

    updateTierlist(userId, id, patch) {
      const row = repo.update(id, userId, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.data !== undefined ? { data: JSON.stringify(patch.data) } : {})
      });
      return row ? toTierlist(row) : undefined;
    },

    deleteTierlist(userId, id) {
      return repo.delete(id, userId);
    }
  };
}

/** The raw document shape the cross-module getter below hands out —
 *  tiers/pool are OPAQUE JSON values cast to their expected shape, never
 *  validated here (same "store and return the document without
 *  understanding its internals" stance as `data` itself). */
export interface TierlistData {
  name: string;
  tiers: Array<{ id: string; label: string; color: string; bookKeys: string[] }>;
  pool: string[];
}

/** tierlists' cross-module public surface — the ONLY way another module
 *  (murals, for its public GET /murals/shared/:token route) may read a
 *  tier list. app.ts gets a ready-built instance from plugin.ts's
 *  getTierlistsPublicApi(), exported through index.ts; never reach into
 *  this module's internals (service.ts, adapters/, domain/) for this —
 *  same module-boundary discipline every cross-module import in this
 *  codebase already follows. */
export interface TierlistsPublicApi {
  getTierlistData(ownerUserId: string, tierlistId: string): TierlistData | undefined;
}

/** Factory over the service. app.ts can't call this directly — it has no
 *  way (and no business) constructing a TierlistsService itself — so
 *  plugin.ts wraps it in the lazily-composed getTierlistsPublicApi(). */
export function createTierlistsPublicApi(service: TierlistsService): TierlistsPublicApi {
  return {
    getTierlistData(ownerUserId, tierlistId) {
      const tierlist = service.getTierlist(ownerUserId, tierlistId);
      if (!tierlist) return undefined;
      const data = (tierlist.data ?? {}) as Partial<Pick<TierlistData, "tiers" | "pool">>;
      return { name: tierlist.name, tiers: data.tiers ?? [], pool: data.pool ?? [] };
    }
  };
}
