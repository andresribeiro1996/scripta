// Domain types for the gallery module — a per-account pool of uploaded
// images, primarily meant to be assignable as custom book covers (see
// frontend's lib/bookCovers.ts and CoverPickerModal.tsx), but stored and
// served generically enough to support other uses later.

/** Row shape as stored. `filename` is the original upload's name kept
 *  purely for display in the gallery UI — never used to build a
 *  filesystem path (see adapters/fs/fsImageBlobStore.ts, which paths by
 *  `id` instead) — so it's safe even if it contains `../` or other
 *  path-traversal-shaped garbage. `extension`/`mime_type` describe the
 *  RE-ENCODED file actually on disk, not whatever the upload originally
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

/** What the service hands back to routes.ts. */
export interface GalleryImage {
  id: string;
  filename: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  createdAt: string;
  /** Where the raw bytes can be fetched — deliberately a plain,
   *  unauthenticated URL keyed by this image's random `id` (see
   *  routes.ts's GET /gallery/:id/file). It has to be usable directly as
   *  an `<img src>` with no Authorization header attached, the same trust
   *  model this app already uses for the Kobo CDN / Open Library cover
   *  URLs BookCard's CoverImage loads today — an unguessable UUID is the
   *  access control, not a session check. */
  url: string;
}
