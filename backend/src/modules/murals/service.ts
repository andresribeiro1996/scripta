// Business logic for the murals module. Depends only on the
// MuralsRepository port, not on SQLite — same reasoning as every other
// module's service.ts.

import { randomUUID } from "node:crypto";
import type { MuralsRepository } from "./domain/ports.js";
import type { Mural, MuralRow } from "./domain/types.js";

function toMural(row: MuralRow): Mural {
  return {
    id: row.id,
    name: row.name,
    blocks: JSON.parse(row.blocks),
    coverImageId: row.cover_image_id,
    coverImageUrl: row.cover_image_url,
    // Always null from this task, regardless of what's in the row —
    // Task 4 adds the share/unshare routes and starts surfacing these.
    shareToken: null,
    shareUrl: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export interface MuralsService {
  listMurals(userId: string): Mural[];
  createMural(userId: string, name: string): Mural;
  /** undefined if no mural with that id is owned by userId — a
   *  caller-facing 404, not a server error. Same convention as
   *  modules/gallery/service.ts's getImageFile. */
  getMural(userId: string, id: string): Mural | undefined;
  /** Partial merge onto the existing row — only the keys present in
   *  `patch` change. undefined if not owned. */
  updateMural(userId: string, id: string, patch: { name?: string; blocks?: unknown[] }): Mural | undefined;
  /** Returns false if no mural with that id was owned by userId — same
   *  convention as modules/gallery/service.ts's deleteImage. */
  deleteMural(userId: string, id: string): boolean;
  /** undefined if not owned. */
  setCover(userId: string, id: string, imageId: string, url: string): Mural | undefined;
  /** undefined if not owned. */
  clearCover(userId: string, id: string): Mural | undefined;
}

export function createMuralsService(repo: MuralsRepository): MuralsService {
  return {
    listMurals(userId) {
      return repo.listByUser(userId).map(toMural);
    },

    createMural(userId, name) {
      const now = new Date().toISOString();
      const row: MuralRow = {
        id: randomUUID(),
        user_id: userId,
        name,
        blocks: "[]",
        cover_image_id: null,
        cover_image_url: null,
        share_token: null,
        created_at: now,
        updated_at: now
      };
      repo.insert(row);
      return toMural(row);
    },

    getMural(userId, id) {
      const row = repo.getOwned(id, userId);
      return row ? toMural(row) : undefined;
    },

    updateMural(userId, id, patch) {
      const row = repo.update(id, userId, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.blocks !== undefined ? { blocks: JSON.stringify(patch.blocks) } : {})
      });
      return row ? toMural(row) : undefined;
    },

    deleteMural(userId, id) {
      return repo.delete(id, userId);
    },

    setCover(userId, id, imageId, url) {
      const row = repo.update(id, userId, { cover_image_id: imageId, cover_image_url: url });
      return row ? toMural(row) : undefined;
    },

    clearCover(userId, id) {
      const row = repo.update(id, userId, { cover_image_id: null, cover_image_url: null });
      return row ? toMural(row) : undefined;
    }
  };
}
