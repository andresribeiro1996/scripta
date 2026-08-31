// The port: everything the murals domain (service.ts) needs from
// persistence. Same shape of contract as modules/library/domain/ports.ts
// and modules/gallery/domain/ports.ts — service.ts is written against
// this interface only, with no idea whether SQLite, Postgres, or an
// in-memory fake is on the other side.

import type { MuralFolderRow, MuralRow } from "./types.js";

export interface MuralsRepository {
  listByUser(userId: string): MuralRow[];
  /** Ownership-checked lookup — undefined if no row with that id exists,
   *  or it exists but isn't owned by userId. service.ts treats both cases
   *  identically (a caller-facing 404, not a server error). */
  getOwned(id: string, userId: string): MuralRow | undefined;
  insert(row: MuralRow): void;
  /** Ownership-checked partial update — merges `patch` onto the existing
   *  row (only the keys present in `patch` change) and returns the
   *  merged, persisted row. Returns undefined if no row with that id was
   *  owned by userId. */
  update(
    id: string,
    userId: string,
    patch: Partial<Pick<MuralRow, "name" | "blocks" | "cover_image_id" | "cover_image_url" | "folder_id">>
  ): MuralRow | undefined;
  /** Returns true if a row was actually deleted (i.e. it existed AND was
   *  owned by userId). */
  delete(id: string, userId: string): boolean;
  /** Ownership-checked: sets (or, with `token: null`, clears) the
   *  share_token on this mural. Returns undefined if no row with that id
   *  was owned by userId — service.ts turns that into the same 404 every
   *  other `/murals/:id/*` route gives for an unowned/missing mural. */
  setShareToken(id: string, userId: string, token: string | null): MuralRow | undefined;
  /** Looks up a mural by its live share token — backs the public
   *  GET /murals/shared/:token route. No ownership/userId involved: the
   *  token itself is the credential, same trust model as
   *  modules/library's getByShareToken/modules/gallery's getImageById.
   *  Returns the RAW row (including user_id) — callers of this one
   *  method are trusted to keep user_id server-side only. */
  getByShareToken(token: string): MuralRow | undefined;
  listFoldersByUser(userId: string): MuralFolderRow[];
  getOwnedFolder(id: string, userId: string): MuralFolderRow | undefined;
  insertFolder(row: MuralFolderRow): void;
  updateFolder(
    id: string,
    userId: string,
    patch: Partial<Pick<MuralFolderRow, "name" | "parent_id">>
  ): MuralFolderRow | undefined;
  reparentFolderChildren(folderId: string, userId: string, parentId: string | null): void;
  deleteFolder(id: string, userId: string): boolean;
}
