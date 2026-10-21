import type { DiscoverItem } from "../community/types.js";

export type TopShelfPeriod = "month" | "all";
export type TopShelfBoard = "champions" | "crowned" | "tiered" | "highestTier" | "quizzed" | "risingStar";
export type TopShelfView = TopShelfBoard | "games";
export type TopShelfBook = { workId: string; title: string; author: string; coverUrl: string | null; value: number };
export type TopShelfGame = { item: DiscoverItem; likes: number; votes: number; comments: number };
export type TopShelf = {
  period: TopShelfPeriod;
  genre: string | null;
  genres: string[];
  boards: Partial<Record<TopShelfBoard, TopShelfBook[]>>;
  genreChampions: Array<{ genre: string; book: TopShelfBook }>;
  games: TopShelfGame[];
};

export type TopShelfRecapCard =
  | { kind: "summary"; gamesPublished: number; votesCast: number; booksInPlay: number }
  | { kind: "book"; board: TopShelfBoard; book: TopShelfBook; game: DiscoverItem | null }
  | { kind: "hottestGame"; game: TopShelfGame; open: boolean };
export type TopShelfRecap = { month: string; cards: TopShelfRecapCard[] };
export type TopShelfRecapIndex = { months: string[]; currentMonth: string; announce: boolean };
