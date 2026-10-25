import type { BookSeries } from "../library/bookSearch.js";
import type { ReaderProfile } from "../murals/murals.js";
import type { IdentityKey } from "../readerCards/index.js";

export type WorkReadStatus = 0 | 1 | 2;

export type WorkEdition = { bookId: string; title: string; language: string | null; year: number | null; isbn: string | null; coverUrl: string | null; coverColor: string | null; pages: number | null; mine: boolean; collection?: BookSeries | null };

export type WorkMine = { bookKey: string; readStatus: WorkReadStatus; rating: number | null; highlightCount: number };

export type WorkReader = ReaderProfile & { readerGlyph?: IdentityKey; readStatus: WorkReadStatus; published: boolean };

export type WorkGameRef = { id: string; name: string; owner: ReaderProfile | "app"; path: string };

export type WorkRating = { value: number; count: number };

export type WorkAward = { prize: string; year: number; won: boolean };

export type AwardWinner = { workId: string; title: string; author: string; coverUrl: string | null };

export type AwardAnnouncement = { prize: string; year: number; announcedAt: string; winners: AwardWinner[]; nomineeWorkIds: string[]; honoree: { name: string; workIds: string[] } | null };

export type RecentAwards = { announcements: AwardAnnouncement[] };

export type WorkPage = {
  work: { id: string; title: string; author: string; summary: string | null; coverUrl: string | null; coverColor: string | null; editions: WorkEdition[]; genres: string[]; possibleGenres?: string[]; rating: WorkRating | null; year: number | null; pages: number | null; series?: BookSeries | null; awards?: WorkAward[]; characters?: string[] };
  mine: WorkMine | null;
  readers: { followed: WorkReader[]; others: WorkReader[]; counts: { readers: number; finished: number } };
  games: { tierlists: WorkGameRef[]; arenas: WorkGameRef[]; quizzes: WorkGameRef[] };
};
