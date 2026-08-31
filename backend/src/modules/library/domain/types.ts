// Domain types for the library module.
//
// This module used to treat the library as one opaque JSON blob per user.
// It is now decomposed into entities (see adapters/sqlite/schema.sql for
// why). The document shape below still exists because it is the wire
// format the frontend currently speaks — `GET`/`PUT /library` continue to
// accept and return it, assembled from and decomposed into the entity
// rows by domain/document.ts. Slice 2 adds per-entity endpoints alongside
// it; slice 3 retires the document. See docs/DEPLOYMENT-PLAN.md.

/** A book record as it arrives from an importer. Deliberately open —
 *  exporter/ emits whatever columns the Kobo device actually had, a
 *  Goodreads CSV carries a different set, and the app adds its own
 *  `_`-prefixed fields. Nothing here may assume a field exists. */
export type BookRecord = Record<string, unknown>;

/** A highlight/annotation record. Same open shape, same reasoning. */
export type HighlightRecord = Record<string, unknown>;

/** The library-level settings row — everything about a user's library
 *  that isn't a book, group, or mural. */
export interface LibrarySettings {
  name: string | null;
  source: string | null;
  schemaVersion: number | null;
  style: unknown | null;
  /** Top-level document fields with no column of their own, kept verbatim
   *  so a field a future importer adds survives a round trip without
   *  needing a schema change. Empty for most libraries. */
  extra: Record<string, unknown>;
  version: number;
  updatedAt: string;
}

/** One book, with its highlights rejoined. `bookKey` is the app's
 *  cross-source identity (see frontend/src/lib/merge.ts's bookKey) and is
 *  what groups and mural blocks reference. */
export interface Book {
  bookKey: string;
  title: string | null;
  author: string | null;
  isbn: string | null;
  series: string | null;
  sortPosition: number | null;
  /** The full record minus `highlights`, which live in `highlights`. */
  data: BookRecord;
  highlights: HighlightRecord[];
}

export type GroupType = "series" | "collection";

export interface Group {
  id: string;
  type: GroupType;
  name: string;
  style: unknown | null;
  bookKeys: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BlockLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MuralBlock {
  id: string;
  type: string;
  layout: BlockLayout;
  /** The block's variant-specific fields and style. MuralBlock is a
   *  ten-variant union on the frontend; this module doesn't need to
   *  understand the variants, only to store them per-block so a single
   *  block can be written without rewriting its neighbours. */
  data: Record<string, unknown>;
}

export interface Mural {
  id: string;
  name: string;
  blocks: MuralBlock[];
  coverImageId: string | null;
  coverImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Everything belonging to one user's library, as entities. This is what
 *  the repository reads and writes. */
export interface LibraryContents {
  settings: LibrarySettings;
  books: Book[];
  groups: Group[];
  murals: Mural[];
}

/** The wire/document shape — the same JSON the exporter and viewer use,
 *  which is what the frontend still sends and receives. Extra top-level
 *  fields an importer sets are preserved verbatim (see document.ts's
 *  `extra` handling), so a new importer field doesn't need a schema
 *  change to survive a round trip. */
export interface LibraryDocument {
  data: unknown;
  updatedAt: string;
  /** The library's version at the time of this read, for the optimistic
   *  concurrency check landing in slice 2. */
  version: number;
}
