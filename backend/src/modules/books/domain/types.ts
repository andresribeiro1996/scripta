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
  summary_hash: string | null;
  original_title: string | null;
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
  work_id: string | null;
  language: string | null;
  work_checked_at: string | null;
  title_key: string | null;
  title_group_blocked_at: string | null;
  genres_source: GenresSource | null;
  genres_confidence: number | null;
  created_at: string;
}

export type GenresSource = "jev" | "manual";

export interface CoverImageRow {
  id: string;
  book_id: string;
  source: CoverSourceName;
  source_url: string | null;
  origin?: string | null;
  width: number;
  height: number;
  byte_size: number;
  color: string | null;
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

export interface LossyBook {
  id: string;
  title: string;
  author: string;
  isbn: string | null;
  work_id: string | null;
  work_title: string | null;
  work_author: string | null;
}

export type WorkPageRows = {
  work: { id: string; title: string; author: string; summary: string | null; summary_hash: string | null };
  aliasIds: string[];
  editions: Array<{ id: string; title: string; language: string | null; year: number | null; isbn: string | null; summary: string | null; summary_hash: string | null; cover_image_id: string | null; cover_color: string | null; genres: string; rating: number | null; rating_count: number; pages: number | null; genres_source: GenresSource | null; genres_confidence: number | null }>;
};

export interface WorkView {
  id: string;
  olWorkKey: string | null;
  title: string;
  author: string;
  editions: Array<{ id: string; isbn: string | null; title: string; author: string; olWorkKey: string | null }>;
}

export type GenreEvidence = {
  work: { id: string; title: string; author: string; summary: string | null };
  editions: Array<{ title: string; language: string | null; isbn: string | null; publisher: string | null; year: number | null; summary: string | null }>;
};

export type JevTask = "synopses" | "works";
export type JevRejection = { status: number | null; reason: string; attempts: number; lastAt: string };

export type MergeSource = "title-key" | "admin" | "code" | "jev" | "manual";

export type WorkMatchJudgment = { model: string; intoWorkId: string | null; confidence: number | null; askedAt: string };
