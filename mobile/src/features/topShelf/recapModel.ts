import { plural, recapMonthName, type TopShelfBoard, type TopShelfRecapCard } from "@scripta/shared";
import { contentTarget } from "@scripta/shared/community";
import { gameScoreLabel, valueLabel } from "./topShelfModel";
import { getLocale } from "../../i18n";

const RECORD_TITLES: Record<Exclude<TopShelfBoard, "champions">, [string, string]> = {
  crowned: ["👑", "most crowned"],
  tiered: ["📊", "most tiered"],
  highestTier: ["⭐", "highest tier"],
  quizzed: ["❓", "most quizzed"],
  risingStar: ["🌱", "rising star"],
};

const VOTE_VERBS = { tierlist: "Rank it yourself", quiz: "Play it yourself", tournament: "Vote in the bracket" } as const;

export function recapTitle(card: TopShelfRecapCard, month: string): string {
  const locale = getLocale();
  const name = recapMonthName(month, locale);
  switch (card.kind) {
    case "summary": return `${name} on Atmyshelf`;
    case "hottestGame": return `🔥 ${name}'s hottest game`;
    case "dailyChapter": return `📖 ${name}'s Daily Chapter`;
    case "book": {
      if (card.board === "champions") return "Book of the month";
      const [emoji, words] = RECORD_TITLES[card.board];
      return `${emoji} ${name}'s ${words}`;
    }
  }
}

export function recapNumber(card: TopShelfRecapCard): string {
  switch (card.kind) {
    case "summary": return `${card.gamesPublished} games published\n${card.votesCast} votes cast\n${card.booksInPlay} books in play`;
    case "hottestGame": return gameScoreLabel(card.game);
    case "dailyChapter": return [
      `${plural(card.players, "reader", "readers")} played`,
      ...(card.hardest ? [`Hardest: ${card.hardest.title} · ${card.hardest.average}/5`] : []),
      ...(card.mostMissed ? [`Most missed: ${card.mostMissed.title} · ${card.mostMissed.missedPercent}%`] : []),
      ...(card.topPlayers.length ? [`Most perfect: ${card.topPlayers.map((p) => `@${p.username} (${p.perfect})`).join(", ")}`] : []),
    ].join("\n");
    case "book": return valueLabel(card.board, card.book.value);
  }
}

export function recapCta(card: TopShelfRecapCard, currentMonth: string): string {
  const locale = getLocale();
  switch (card.kind) {
    case "summary": return "Join in on Atmyshelf";
    case "dailyChapter": return "Play today's Daily Chapter";
    case "hottestGame": return card.open ? "Play it yourself" : "See how it ended";
    case "book": return card.game ? `${VOTE_VERBS[card.game.content.kind]} — it counts for ${recapMonthName(currentMonth, locale)}` : `See ${card.book.title} on Atmyshelf`;
  }
}

export function recapLinkPath(card: TopShelfRecapCard): string {
  switch (card.kind) {
    case "summary": return "/";
    case "dailyChapter": return "/daily";
    case "hottestGame": return contentTarget(card.game.item.content);
    case "book": return card.game ? contentTarget(card.game.content) : `/work/${encodeURIComponent(card.book.workId)}`;
  }
}

export function recapEntries(index: { months: string[]; currentMonth: string }): { play: string | null; past: string[] } {
  const [year, month] = index.currentMonth.split("-").map(Number) as [number, number];
  const previous = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
  const latest = index.months[0];
  if (latest === undefined || latest < previous) return { play: null, past: index.months };
  return { play: latest, past: index.months.slice(1) };
}
