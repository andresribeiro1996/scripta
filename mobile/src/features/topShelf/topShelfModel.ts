import { genreLabel, isBookGenre, tierBand, type TopShelf, type TopShelfBoard, type TopShelfGame, type TopShelfPeriod, type TopShelfView } from "@scripta/shared";
import type { Locale } from "@scripta/shared/i18n";
import { translatorFor, type MobileMessages } from "../../i18n";

type MessageKey = Extract<keyof MobileMessages, string>;

export const BOARD_ORDER: TopShelfBoard[] = ["crowned", "tiered", "highestTier", "quizzed", "risingStar"];

const TITLES = {
  crowned: "sharing.titleCrowned",
  tiered: "sharing.titleTiered",
  highestTier: "sharing.titleHighestTier",
  quizzed: "sharing.titleQuizzed",
  risingStar: "sharing.titleRisingStar",
  games: "sharing.hottestGames",
} as const satisfies Record<Exclude<TopShelfView, "champions">, MessageKey>;

const VIEWS: readonly string[] = [...BOARD_ORDER, "champions", "games"];

export const isTopShelfView = (view: string): view is TopShelfView => VIEWS.includes(view);

export const genreName = (genre: string, locale: Locale) => (isBookGenre(genre) ? genreLabel(genre, locale) : genre);

export function boardTitle(view: TopShelfView, genre: string | null, locale: Locale): string {
  const t = translatorFor(locale);
  if (view === "champions") return genre ? t("sharing.genreChampions", { genre: genreName(genre, locale) }) : t("sharing.champions");
  return t(TITLES[view]);
}

export function valueLabel(board: TopShelfBoard, value: number, locale: Locale): string {
  const t = translatorFor(locale);
  switch (board) {
    case "crowned": return t("sharing.valueCrowned", { count: value });
    case "tiered": return t("sharing.valueTiered", { count: value });
    case "highestTier": return tierBand(value, locale);
    case "quizzed": return t("sharing.valueQuizzed", { count: value });
    case "risingStar": return t("sharing.valueRisingStar", { count: value });
    case "champions": return t("sharing.valueChampions", { count: value });
  }
}

export const gameScore = (game: TopShelfGame) => game.likes + game.votes + game.comments;

export function gameScoreLabel(game: TopShelfGame, locale: Locale): string {
  return translatorFor(locale)("sharing.interactions", { count: gameScore(game) });
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
