// Row shape mirrors modules/gallery/domain/types.ts's own GalleryImageRow —
// snake_case, exactly the SQLite columns (see adapters/sqlite/schema.sql) —
// vs. CachedCover below, the camelCase shape actually returned to callers.

export interface CachedCoverRow {
  id: string;
  cache_key: string;
  source: string;
  mime_type: string;
  extension: string;
  width: number;
  height: number;
  byte_size: number;
  created_at: string;
}

export interface CachedCover {
  id: string;
  source: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  createdAt: string;
  /** A plain, unauthenticated URL usable directly as an `<img src>` —
   *  same trust model gallery's own GalleryImage.url already has (see
   *  that file's own comment): the id is an unguessable random UUID,
   *  not a session check. */
  url: string;
}
