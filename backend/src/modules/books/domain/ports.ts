import type { BookMetadata, BookSearchResult, CatalogBookMetadata } from "@scripta/shared";
import type { SynopsisJudgment, SynopsisKind } from "./synopsis.js";
import type { BookRow, CoverImageRow, CoverSourceName, CoverStatus, DataSource, GenreEvidence, GenresSource, JevRejection, JevTask, NewBook, SummarySource, WorkMatchJudgment, WorkPageRows, WorkView } from "./types.js";

export type MergeableDetails = Pick<BookMetadata, "summary" | "pages" | "year" | "publisher" | "translator">;

export interface CoverBlobStore {
  save(id: string, extension: string, bytes: Buffer): Promise<void>;
}

export interface CoverBlobReader {
  read(id: string, extension: string): Promise<Buffer | null>;
}

export interface PageCursor { at: string; row: number }
export interface IdPage { ids: string[]; next: PageCursor | null }

export interface BooksRepository {
  transaction<T>(write: () => T): T;
  findBookByKey(key: string): BookRow | undefined;
  findBooksByKeys(keys: string[]): Map<string, BookRow>;
  getBook(id: string): BookRow | undefined;
  createBook(input: NewBook, keys: string[], createdAt: string): BookRow;
  addKey(key: string, bookId: string): void;
  fillIdentity(id: string, title: string, author: string): void;
  listBlankTitled(): Array<{ id: string; publisher_url: string }>;
  makeSearchable(id: string): void;
  isSearchable(id: string): boolean;
  getImage(id: string): CoverImageRow | undefined;
  insertImage(row: CoverImageRow): void;
  listPendingColorImageIds(limit: number): string[];
  setImageColor(id: string, color: string): void;
  setCover(bookId: string, cover: { imageId: string | null; status: CoverStatus | null; checkedAt: string | null }): void;
  setCoverIf(bookId: string, expectedImageId: string | null, cover: { imageId: string | null; status: CoverStatus | null; checkedAt: string | null }): boolean;
  addRejection(bookId: string, sourceUrl: string, createdAt: string): void;
  listRejectedUrls(bookId: string): Set<string>;
  saveDetails(bookId: string, details: CatalogBookMetadata, sources: DataSource[], summarySource: DataSource | null, checkedAt: string): void;
  mergeDetails(bookId: string, details: MergeableDetails, summarySource: SummarySource | null): void;
  markDetailsMissing(bookId: string, checkedAt: string): void;
  markDetailsAttempted(bookId: string, checkedAt: string): void;
  searchBooks(tokens: string[], limit: number): BookRow[];
  listUncheckedCoverIds(after: PageCursor | null, limit: number): IdPage;
  listUncheckedDetailIds(limit: number): string[];
  setUpgradeWanted(bookId: string, at: string | null): void;
  setAppleChecked(bookId: string, at: string): void;
  setWorkKey(id: string, key: string | null | undefined): void;
  assignMissingWorks(limit: number): number;
  fillTitleKeys(limit: number): number;
  groupKeylessWorks(limit: number, at?: string): number;
  listWorkLookupIds(limit: number, recheckBefore: string): string[];
  markWorkChecked(id: string, at: string): void;
  replaceLanguage(id: string, tag: string): void;
  mergeWorks(fromId: string, intoId: string, at?: string): string;
  detachEdition(bookId: string, at: string): string;
  getWorkView(id: string): WorkView | undefined;
  workPageRows(id: string): WorkPageRows | undefined;
  assignWork(bookId: string): string;
  setWorkSummary(bookId: string, summary: string): void;
  getWorkSummary(bookId: string): { summary: string | null; olWorkKey: string | null; summaryHash: string | null } | undefined;
  canonicalWorkIds(ids: string[]): Map<string, string>;
  worksNeedingGenreJudgment(workIds: string[], limit: number, rejectionLimit: number): string[];
  saveGenreJudgment(judgment: { workId: string; model: string; genre: string | null; confidence: number; askedAt: string }): void;
  genreJudgments(workIds: string[]): Map<string, { model: string; genre: string | null; confidence: number }>;
  applyGenreJudgments(saveLine: number): void;
  applyGenreJudgment(workId: string, saveLine: number): void;
  deleteGenreJudgment(workId: string): void;
  recordGenreRejection(rejection: { workId: string; status: number | null; reason: string; at: string }): void;
  clearGenreRejection(workId: string): void;
  genreRejections(workIds: string[]): Map<string, { status: number | null; reason: string; attempts: number; lastAt: string }>;
  workCoverImageIds(workIds: string[]): Map<string, string>;
  genreEvidence(workId: string): GenreEvidence | undefined;
  setManualGenres(workId: string, genres: string[]): number;
  aliasesOf(workIds: string[]): string[];
  editionGenres(workIds: string[]): Array<{ work_id: string; genres: string; genres_source: GenresSource | null; genres_confidence: number | null }>;
  spendTypesafe(day: string, source: string, limit: number): boolean;
  typesafeUsage(day: string, source: string): number;
  synopsisJudgments(hashes: string[]): Map<string, SynopsisJudgment>;
  saveSynopsisJudgment(hash: string, judgment: SynopsisJudgment): void;
  jevRejections(task: JevTask, subjects: string[]): Map<string, JevRejection>;
  recordJevRejection(rejection: { task: JevTask; subject: string; status: number | null; reason: string; at: string }): void;
  clearJevRejection(task: JevTask, subject: string): void;
  synopsesNeedingJudgment(workIds: string[], limit: number, rejectionLimit: number): string[];
  worksNeedingSynopsisJudgment(workIds: string[], limit: number, rejectionLimit: number): string[];
  synopsisText(hash: string): { text: string; title: string; author: string } | undefined;
  synopsisBacklog(rejectionLimit: number): Array<{ hash: string; workId: string | null; source: string | null; createdAt: string }>;
  flaggedSynopses(reviewBelow: number): Array<{ hash: string; model: string; usable: number; kind: SynopsisKind }>;
  synopsisCarriers(hashes: string[]): Array<{ hash: string; workId: string | null; title: string; author: string; coverImageId: string | null; source: string | null; text: string; isEdition: boolean }>;
  synopsisTexts(): Array<{ hash: string; source: string; title: string; author: string; text: string }>;
  fillOriginalTitle(bookId: string, title: string): void;
  fillOriginalTitlesFromSummaries(workId?: string): number;
  mergeTranslation(fromId: string, intoId: string, source: "code" | "jev" | "manual", confidence: number | null, at: string): string;
  undoMerge(fromId: string, at: string): { into: string; editions: number };
  workMatchJudgments(workIds: string[]): Map<string, WorkMatchJudgment>;
  saveWorkMatchJudgment(workId: string, judgment: WorkMatchJudgment): void;
  portugueseWorksNeedingMatch(workIds: string[] | null, limit: number, rejectionLimit: number, recheckBefore: string | null): string[];
  translationEvidence(workId: string): { workId: string; workAuthor: string; editions: Array<{ title: string; author: string; publisher: string | null; summary: string | null; originalTitle: string | null }> } | undefined;
  titleCandidates(pattern: string): string[];
  authorCandidates(pattern: string): string[];
  matchCandidates(workIds: string[]): Array<{ id: string; title: string; author: string; year: number | null; editions: number; languages: string[] }>;
  workIdsByWorkKeys(keys: string[]): Map<string, string>;
  listPublisherUrls(): Array<{ work_id: string | null; publisher_url: string }>;
  fillSourceGenres(workId: string, genres: string[]): number;
  genreBacklogWorks(limit: number, minSynopsis: number, rejectionLimit: number): string[];
  jevJudgedWorkIds(): string[];
  countEmptyGenreEditions(workId: string): number;
  setLanguage(id: string, tag: string | null): void;
  setPublisherUrl(id: string, url: string): void;
  listUpgradeWantedIds(after: PageCursor | null, limit: number): IdPage;
}

export interface CoverCandidate {
  source: Exclude<CoverSourceName, "upload" | "publisher">;
  url: string;
}

export interface TitledCandidate extends CoverCandidate {
  title: string;
  authors: string[];
}

export interface CoverSource {
  byIsbn(isbn: string): Promise<CoverCandidate[]>;
  byTitle(title: string, author: string, accept: (candidate: TitledCandidate) => boolean, isbn?: string | null): Promise<CoverCandidate[]>;
}

export interface CatalogSearchHit {
  result: BookSearchResult;
  olCoverId: number | null;
  workKey?: string | null;
  source: DataSource;
}

export interface CatalogDetails {
  metadata: CatalogBookMetadata;
  sources: DataSource[];
  summarySource: DataSource | null;
  workKey?: string | null;
  workSummary?: string | null;
}

export interface BookCatalog {
  fetchDetails(lookup: { isbn: string | null; title: string; author: string; language?: string | null }): Promise<CatalogDetails | null>;
  search(query: { isbn: string } | { text: string }): Promise<CatalogSearchHit[]>;
}

export interface EditionRecord {
  title: string;
  workKey: string | null;
  languages: string[];
}

export interface EditionRecordSource {
  fetchEditionRecord(isbn: string): Promise<EditionRecord | null>;
}
