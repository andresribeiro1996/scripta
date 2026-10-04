export type CoverStatus = "good" | "low_res" | "missing" | "manual";
export type DetailsStatus = "found" | "missing";
export type DataSource = "openlibrary" | "isbndb";
export type SummarySource = DataSource | "publisher";
export type CoverSourceName = "isbndb" | "apple" | "openlibrary" | "upload" | "publisher";

export type BookCreator = "seed" | "publisher";

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
  data_sources: string;
  summary_source: SummarySource | null;
  pages: number | null;
  translator: string | null;
  source_url: string | null;
  details_status: DetailsStatus | null;
  details_checked_at: string | null;
  cover_image_id: string | null;
  cover_status: CoverStatus | null;
  cover_checked_at: string | null;
  cover_upgrade_wanted_at: string | null;
  apple_checked_at: string | null;
  ol_work_key: string | null;
  publisher_url: string | null;
  created_by: BookCreator | null;
  created_at: string;
}

export interface CoverImageRow {
  id: string;
  book_id: string;
  source: CoverSourceName;
  source_url: string | null;
  origin?: string | null;
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
  workKey?: string | null;
  genres?: string[];
  sources?: DataSource[];
  createdBy?: BookCreator;
}
