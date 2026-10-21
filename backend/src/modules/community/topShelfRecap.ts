import type { TopShelfBoard } from "@scripta/shared";
import type { GameRef } from "./domain/ports.js";
import { rankTopShelf, type ShelfInput } from "./topShelf.js";

export type RecapBook = { board: TopShelfBoard; workId: string; value: number; candidates: GameRef[] };
export type RecapData = {
  summary: { gamesPublished: number; votesCast: number; booksInPlay: number };
  books: RecapBook[];
  hottest: { ref: GameRef; likes: number; votes: number; comments: number } | null;
};

export const RECAP_BOARDS: TopShelfBoard[] = ["champions", "crowned", "tiered", "highestTier", "quizzed", "risingStar"];

export function freezeRecap(input: ShelfInput, range: { since: string; until: string }): RecapData {
  const ranked = rankTopShelf(input, { since: range.since, until: range.until, genre: null });
  const since = Date.parse(range.since);
  const until = Date.parse(range.until);
  const key = (ref: GameRef) => `${ref.kind}:${ref.id}`;
  const activity = (g: { likes: number; votes: number; comments: number }) => g.likes + g.votes + g.comments;
  const busiest = [...ranked.visibleGames].sort((a, b) => activity(b) - activity(a) || (key(a.ref) < key(b.ref) ? -1 : key(a.ref) > key(b.ref) ? 1 : 0));

  const books = RECAP_BOARDS.flatMap((board): RecapBook[] => {
    const top = ranked.boards[board]?.[0];
    if (!top) return [];
    return [{ board, workId: top.workId, value: top.value, candidates: busiest.filter((g) => g.works.has(top.workId)).map((g) => g.ref) }];
  });

  const published = ranked.visibleGames.filter((g) => g.publishedAt >= since && g.publishedAt < until);
  const hottest = ranked.games[0];

  return {
    summary: {
      gamesPublished: published.length,
      votesCast: ranked.visibleGames.reduce((n, g) => n + g.votes, 0),
      booksInPlay: new Set(published.flatMap((g) => [...g.works])).size,
    },
    books,
    hottest: hottest ? { ref: hottest.ref, likes: hottest.likes, votes: hottest.votes, comments: hottest.comments } : null,
  };
}

export function recapHasCards(data: RecapData): boolean {
  return data.books.length > 0 || data.hottest !== null;
}
