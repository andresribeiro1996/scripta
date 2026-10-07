// Domain types for the murals module.

/** Row shape as stored — `blocks` is the mural's block list as raw JSON
 *  text, kept opaque all the way down (same treatment as `data` in
 *  modules/library/domain/types.ts's LibraryDocumentRow): parsed only at
 *  the edges (service.ts parses on read, stringifies on write). This
 *  module doesn't validate block shape beyond "is it an array." */
export interface MuralRow {
  id: string;
  user_id: string;
  name: string;
  theme: string | null;
  blocks: string;
  cover_image_id: string | null;
  cover_image_url: string | null;
  /** NULL for an unshared mural. Real UNIQUE column already exists in
   *  schema.sql, but nothing in this task ever sets it — Task 4 adds the
   *  share/unshare routes that do. */
  share_token: string | null;
  folder_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MuralFolderRow {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

export type { MuralFolder } from "@scripta/shared";
