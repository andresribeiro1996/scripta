import type { DailyChapterBook, DailyChapterEdition, DailyChapterQuestion } from "@scripta/shared";
import type { PlayRow } from "./types.js";

export interface DailyChapterSnapshotQuestion extends DailyChapterQuestion { book: DailyChapterBook }
export interface StoredDailyChapter extends DailyChapterEdition { snapshot: DailyChapterSnapshotQuestion[] | null }

export interface DailyChapterRepository {
  books(): DailyChapterBook[];
  questions(): DailyChapterQuestion[];
  editions(): StoredDailyChapter[];
  edition(id: string): StoredDailyChapter | undefined;
  saveBook(book: DailyChapterBook): void;
  saveQuestion(question: DailyChapterQuestion): void;
  saveEdition(edition: StoredDailyChapter): boolean;
  publish(id: string, snapshot: DailyChapterSnapshotQuestion[], at: string): boolean;
  importDrafts(books: DailyChapterBook[], questions: DailyChapterQuestion[], editions: StoredDailyChapter[]): void;
  plays(playerId: string): PlayRow[];
  claimGuest(guestKey: string, userId: string): void;
}

export class DailyChapterError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
