import type { ReaderProfile } from "../murals/murals.js";
import type { IdentityKey } from "../readerCards/index.js";

export type WorkReadStatus = 0 | 1 | 2;

export type WorkEdition = { bookId: string; title: string; language: string | null; year: number | null; isbn: string | null; mine: boolean };

export type WorkMine = { bookKey: string; readStatus: WorkReadStatus; rating: number | null; highlightCount: number };

export type WorkReader = ReaderProfile & { readerGlyph?: IdentityKey; readStatus: WorkReadStatus; published: boolean };

export type WorkGameRef = { id: string; name: string; owner: ReaderProfile | "app"; path: string };

export type WorkPage = {
  work: { id: string; title: string; author: string; summary: string | null; coverUrl: string | null; editions: WorkEdition[] };
  mine: WorkMine | null;
  readers: { followed: WorkReader[]; others: WorkReader[]; counts: { readers: number; finished: number } };
  games: { tierlists: WorkGameRef[]; arenas: WorkGameRef[]; quizzes: WorkGameRef[] };
};
