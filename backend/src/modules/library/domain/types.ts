// Domain types for the library module.

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
}
