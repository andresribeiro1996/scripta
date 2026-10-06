// Domain types for the library module.

import type { IdentityKey } from "@scripta/shared";

/** Row shape as stored — `data` is the library JSON as raw text. Nothing
 *  in this module needs to look inside that JSON (no server-side search
 *  or filtering yet), so it's kept opaque all the way down: parsed only
 *  at the edges (service.ts parses on read, stringifies on write). */
export interface LibraryDocumentRow {
  user_id: string;
  data: string;
  updated_at: string;
  /** NULL until the user shares their library; set back to NULL on
   *  unshare. Unique among non-null values — see
   *  adapters/sqlite/connection.ts's partial unique index for why a plain
   *  column-level UNIQUE couldn't be used here. */
  share_token: string | null;
}

/** What the service hands back to routes.ts — `data` here is the parsed
 *  JSON value (the same shape as the exporter/viewer's library.json:
 *  {source, schema_version, book_count, books, ...}), not the raw text. */
export interface LibraryDocument {
  data: unknown;
  updatedAt: string;
  shareToken: string | null;
  /** The absolute, externally-reachable URL for GET /library/shared/:token
   *  — null whenever shareToken is null. Same "compute at the edge, off a
   *  publicUrlFor closure" pattern as modules/gallery's GalleryImage.url. */
  shareUrl: string | null;
  works: Record<string, string>;
}

export interface LibraryDocumentText {
  data: string;
  updatedAt: string;
  shareToken: string | null;
  shareUrl: string | null;
  works: Record<string, string>;
}

export interface LibraryMatchKeyRow {
  key: string;
  book_ref: number;
  title: string;
  author: string;
  isbn: string | null;
  cover: string | null;
}

export interface LibraryDerived {
  glyph: IdentityKey | null;
  keys: LibraryMatchKeyRow[];
}

export interface LibraryBookRow {
  position: number;
  book_key: string;
  title: string | null;
  author: string | null;
  isbn: string | null;
  image_id: string | null;
  read_status: number | null;
  series_number: number | null;
  sort_order: number | null;
  cover_url: string | null;
  finished_year: number | null;
  work_id: string | null;
  row_hash: string;
}

export interface LibraryHighlightRow {
  highlight_id: string;
  text: string | null;
  annotation: string | null;
}

export interface LibraryBookRows {
  book: LibraryBookRow;
  highlights: LibraryHighlightRow[];
}

export interface LibrarySummaryRow {
  meta: string | null;
  reader_card: string | null;
  shelf_theme: string | null;
  total_books: number;
  finished_count: number;
  in_progress_count: number;
  total_highlights: number;
}

export interface LibraryRows {
  books: LibraryBookRows[];
  summary: LibrarySummaryRow;
}

export interface LibrarySmallSave {
  books: LibraryBookRow[];
  counts: { finished: number; inProgress: number };
  meta: string | "keep";
  readerCard: string | null | "keep";
}
