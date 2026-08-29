// The port: everything the murals domain (service.ts) needs from
// persistence. Same shape of contract as modules/library/domain/ports.ts
// and modules/gallery/domain/ports.ts — service.ts is written against
// this interface only, with no idea whether SQLite, Postgres, or an
// in-memory fake is on the other side.

import type { MuralRow } from "./types.js";

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
    patch: Partial<Pick<MuralRow, "name" | "blocks" | "cover_image_id" | "cover_image_url">>
  ): MuralRow | undefined;
  /** Returns true if a row was actually deleted (i.e. it existed AND was
   *  owned by userId). */
  delete(id: string, userId: string): boolean;
}
