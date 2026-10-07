// Domain types for the gallery module — a per-account pool of uploaded
// images, primarily meant to be assignable as custom book covers (see
// frontend's lib/bookCovers.ts and CoverPickerModal.tsx), but stored and
// served generically enough to support other uses later.

/** Row shape as stored. `filename` is the original upload's name kept
 *  purely for display in the gallery UI — never used to build an
 *  object key (plugin.ts keys by `id` instead) — so it's safe even if it contains `../` or other
 *  path-traversal-shaped garbage. `extension`/`mime_type` describe the
 *  RE-ENCODED file actually stored, not whatever the upload originally
 *  was (see service.ts's uploadImage — every upload is normalized to a
 *  single output format). */
export interface GalleryImageRow {
  id: string;
  user_id: string;
  filename: string;
  mime_type: string;
  extension: string;
  width: number;
  height: number;
  byte_size: number;
  created_at: string;
}

export type { GalleryImage } from "@scripta/shared";
