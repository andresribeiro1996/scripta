// Business logic for the murals module. Depends only on the
// MuralsRepository port, not on SQLite — same reasoning as every other
// module's service.ts.

import { randomUUID } from "node:crypto";
import { FolderCycleError, InvalidFolderReferenceError } from "./domain/errors.js";
import type { MuralsRepository } from "./domain/ports.js";
import type { Mural, MuralFolder, MuralFolderRow, MuralRow } from "./domain/types.js";

function toMural(row: MuralRow, publicUrlFor: (token: string) => string): Mural {
  return {
    id: row.id,
    name: row.name,
    blocks: JSON.parse(row.blocks),
    coverImageId: row.cover_image_id,
    coverImageUrl: row.cover_image_url,
    shareToken: row.share_token,
    shareUrl: row.share_token ? publicUrlFor(row.share_token) : null,
    folderId: row.folder_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toFolder(row: MuralFolderRow): MuralFolder {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export interface MuralsService {
  listMurals(userId: string): Mural[];
  createMural(userId: string, name: string, folderId?: string | null): Mural;
  /** undefined if no mural with that id is owned by userId — a
   *  caller-facing 404, not a server error. Same convention as
   *  modules/gallery/service.ts's getImageFile. */
  getMural(userId: string, id: string): Mural | undefined;
  /** Partial merge onto the existing row — only the keys present in
   *  `patch` change. undefined if not owned. */
  updateMural(userId: string, id: string, patch: { name?: string; blocks?: unknown[]; folderId?: string | null }): Mural | undefined;
  /** Returns false if no mural with that id was owned by userId — same
   *  convention as modules/gallery/service.ts's deleteImage. */
  deleteMural(userId: string, id: string): boolean;
  /** undefined if not owned. */
  setCover(userId: string, id: string, imageId: string, url: string): Mural | undefined;
  /** undefined if not owned. */
  clearCover(userId: string, id: string): Mural | undefined;
  /** Idempotent: a mural that's already shared keeps its existing token
   *  rather than minting a new one, so a re-opened share modal (or a
   *  retried request) never invalidates a link someone already has.
   *  undefined if not owned. */
  share(userId: string, id: string): Mural | undefined;
  /** undefined if not owned. */
  unshare(userId: string, id: string): Mural | undefined;
  listFolders(userId: string): MuralFolder[];
  createFolder(userId: string, name: string, parentId?: string | null): MuralFolder;
  renameFolder(userId: string, id: string, name: string): MuralFolder | undefined;
  moveFolder(userId: string, id: string, parentId: string | null): MuralFolder | undefined;
  deleteFolder(userId: string, id: string): boolean;
  /** Backs the public GET /murals/shared/:token route. Returns the RAW
   *  row (with `user_id` and the raw `blocks` string) — deliberately NOT
   *  the owner-scoped `Mural` DTO the rest of this service returns, since
   *  routes.ts needs `user_id` (to resolve library data) and unparsed
   *  `blocks` (to feed extractReferences) that every other method here
   *  intentionally hides from callers. Used only by that one route. */
  getRowByShareToken(token: string): MuralRow | undefined;
}

export function createMuralsService(repo: MuralsRepository, publicUrlFor: (token: string) => string): MuralsService {
  return {
    listMurals(userId) {
      return repo.listByUser(userId).map((row) => toMural(row, publicUrlFor));
    },

    createMural(userId, name, folderId = null) {
      if (folderId !== null && !repo.getOwnedFolder(folderId, userId)) throw new InvalidFolderReferenceError();
      const now = new Date().toISOString();
      const row: MuralRow = {
        id: randomUUID(),
        user_id: userId,
        name,
        blocks: "[]",
        cover_image_id: null,
        cover_image_url: null,
        share_token: null,
        folder_id: folderId,
        created_at: now,
        updated_at: now
      };
      repo.insert(row);
      return toMural(row, publicUrlFor);
    },

    getMural(userId, id) {
      const row = repo.getOwned(id, userId);
      return row ? toMural(row, publicUrlFor) : undefined;
    },

    updateMural(userId, id, patch) {
      if (patch.folderId !== undefined && patch.folderId !== null && !repo.getOwnedFolder(patch.folderId, userId)) {
        throw new InvalidFolderReferenceError();
      }
      const row = repo.update(id, userId, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.blocks !== undefined ? { blocks: JSON.stringify(patch.blocks) } : {}),
        ...(patch.folderId !== undefined ? { folder_id: patch.folderId } : {})
      });
      return row ? toMural(row, publicUrlFor) : undefined;
    },

    deleteMural(userId, id) {
      return repo.delete(id, userId);
    },

    setCover(userId, id, imageId, url) {
      const row = repo.update(id, userId, { cover_image_id: imageId, cover_image_url: url });
      return row ? toMural(row, publicUrlFor) : undefined;
    },

    clearCover(userId, id) {
      const row = repo.update(id, userId, { cover_image_id: null, cover_image_url: null });
      return row ? toMural(row, publicUrlFor) : undefined;
    },

    share(userId, id) {
      const existing = repo.getOwned(id, userId);
      if (!existing) return undefined;
      if (existing.share_token) return toMural(existing, publicUrlFor);

      const row = repo.setShareToken(id, userId, randomUUID());
      // Can only be undefined if the row vanished between the getOwned
      // above and here — nothing in this module deletes murals out from
      // under a concurrent request in practice, but keeps the return
      // type honest rather than asserting non-null (same reasoning as
      // modules/library/service.ts's own share()).
      return row ? toMural(row, publicUrlFor) : undefined;
    },

    unshare(userId, id) {
      const row = repo.setShareToken(id, userId, null);
      return row ? toMural(row, publicUrlFor) : undefined;
    },

    listFolders(userId) {
      return repo.listFoldersByUser(userId).map(toFolder);
    },

    createFolder(userId, name, parentId = null) {
      if (parentId !== null && !repo.getOwnedFolder(parentId, userId)) throw new InvalidFolderReferenceError();
      const now = new Date().toISOString();
      const row: MuralFolderRow = {
        id: randomUUID(),
        user_id: userId,
        name,
        parent_id: parentId,
        created_at: now,
        updated_at: now
      };
      repo.insertFolder(row);
      return toFolder(row);
    },

    renameFolder(userId, id, name) {
      const row = repo.updateFolder(id, userId, { name });
      return row ? toFolder(row) : undefined;
    },

    moveFolder(userId, id, parentId) {
      const existing = repo.getOwnedFolder(id, userId);
      if (!existing) return undefined;
      if (parentId !== null) {
        if (parentId === id) throw new FolderCycleError();
        if (!repo.getOwnedFolder(parentId, userId)) throw new InvalidFolderReferenceError();
        const all = repo.listFoldersByUser(userId);
        const byId = new Map(all.map((f) => [f.id, f]));
        let current: string | null = byId.get(parentId)?.parent_id ?? null;
        while (current !== null) {
          if (current === id) throw new FolderCycleError();
          current = byId.get(current)?.parent_id ?? null;
        }
      }
      const row = repo.updateFolder(id, userId, { parent_id: parentId });
      return row ? toFolder(row) : undefined;
    },

    deleteFolder(userId, id) {
      const existing = repo.getOwnedFolder(id, userId);
      if (!existing) return false;
      repo.reparentFolderChildren(id, userId, existing.parent_id);
      return repo.deleteFolder(id, userId);
    },

    getRowByShareToken(token) {
      return repo.getByShareToken(token);
    }
  };
}
