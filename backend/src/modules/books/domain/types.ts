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

export type CoverStatus = "good" | "low_res" | "missing" | "manual";
export type DetailsStatus = "found" | "missing";
export type CoverSourceName = "isbndb" | "apple" | "openlibrary" | "upload";

export interface BookRow {
  id: string;
  title: string;
  author: string;
  year: number | null;
  publisher: string | null;
  isbn: string | null;
  ol_cover_id: number | null;
  summary: string | null;
  rating: number | null;
  rating_count: number;
  genres: string;
  source_url: string | null;
  details_status: DetailsStatus | null;
  details_checked_at: string | null;
  cover_image_id: string | null;
  cover_status: CoverStatus | null;
  cover_checked_at: string | null;
  created_at: string;
}

export interface CoverImageRow {
  id: string;
  book_id: string;
  source: CoverSourceName;
  source_url: string | null;
  width: number;
  height: number;
  byte_size: number;
  created_at: string;
}

export interface NewBook {
  title: string;
  author: string;
  isbn: string | null;
  year?: number | null;
  publisher?: string | null;
  olCoverId?: number | null;
  genres?: string[];
}
