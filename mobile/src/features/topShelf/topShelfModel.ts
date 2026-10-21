import { tierBand, type TopShelf, type TopShelfBoard, type TopShelfGame, type TopShelfPeriod, type TopShelfView } from "@scripta/shared";

export const BOARD_ORDER: TopShelfBoard[] = ["crowned", "tiered", "highestTier", "quizzed", "risingStar"];

const TITLES: Record<Exclude<TopShelfView, "champions">, string> = {
  crowned: "Most crowned",
  tiered: "Most tiered",
  highestTier: "Highest tier",
  quizzed: "Most quizzed",
  risingStar: "Rising star",
  games: "Hottest games",
};

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function boardTitle(view: TopShelfView, genre: string | null): string {
  if (view === "champions") return genre ? `${genre} champions` : "Champions";
  return TITLES[view];
}

export function valueLabel(board: TopShelfBoard, value: number): string {
  switch (board) {
    case "crowned": return plural(value, "title", "titles");
    case "tiered": return plural(value, "list", "lists");
    case "highestTier": return tierBand(value);
    case "quizzed": return plural(value, "quiz", "quizzes");
    case "risingStar": return plural(value, "game", "games");
    case "champions": return `${value} pts`;
  }
}

export const gameScore = (game: TopShelfGame) => game.likes + game.votes + game.comments;

export function gameScoreLabel(game: TopShelfGame): string {
  return plural(gameScore(game), "interaction", "interactions");
}

export function barFraction(board: TopShelfBoard, value: number, leader: number): number {
  const fraction = board === "highestTier" ? 1 - value : leader > 0 ? value / leader : 0;
  return Math.min(1, Math.max(0.04, fraction));
}

export function visibleBoards(period: TopShelfPeriod): TopShelfBoard[] {
  return period === "month" ? BOARD_ORDER : BOARD_ORDER.filter((board) => board !== "risingStar");
}

export function genreMenu(genres: string[], selected: string | null): string[] {
  return selected && !genres.includes(selected) ? [...genres, selected] : genres;
}

export function emptySections(data: TopShelf) {
  return {
    podium: (data.boards.champions ?? []).length === 0,
    records: visibleBoards(data.period).every((board) => (data.boards[board] ?? []).length === 0),
    genres: data.genreChampions.length === 0,
    games: data.games.length === 0,
  };
}
