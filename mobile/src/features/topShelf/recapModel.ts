import { recapMonthName, type TopShelfBoard, type TopShelfRecapCard } from "@scripta/shared";
import { contentTarget } from "@scripta/shared/community";
import { decimalText, type Locale } from "@scripta/shared/i18n";
import { gameScoreLabel, valueLabel } from "./topShelfModel";
import { translatorFor, type MessageKey } from "../../i18n";

const RECORD_TITLES = {
  crowned: "sharing.recapCrownedTitle",
  tiered: "sharing.recapTieredTitle",
  highestTier: "sharing.recapHighestTierTitle",
  quizzed: "sharing.recapQuizzedTitle",
  risingStar: "sharing.recapRisingStarTitle",
} as const satisfies Record<Exclude<TopShelfBoard, "champions">, MessageKey>;

const VOTE_CTAS = {
  tierlist: "sharing.recapCtaRank",
  quiz: "sharing.recapCtaPlay",
  tournament: "sharing.recapCtaVote",
} as const satisfies Record<string, MessageKey>;

export function recapTitle(card: TopShelfRecapCard, month: string, locale: Locale): string {
  const t = translatorFor(locale);
  const name = recapMonthName(month, locale);
  switch (card.kind) {
    case "summary": return t("sharing.recapSummaryTitle", { month: name });
    case "hottestGame": return t("sharing.recapHottestTitle", { month: name });
    case "dailyChapter": return t("sharing.recapDailyTitle", { month: name });
    case "book": return card.board === "champions" ? t("sharing.bookOfTheMonth") : t(RECORD_TITLES[card.board], { month: name });
  }
}

export function recapNumber(card: TopShelfRecapCard, locale: Locale): string {
  const t = translatorFor(locale);
  switch (card.kind) {
    case "summary": return [t("sharing.recapSummaryGames", { count: card.gamesPublished }), t("sharing.recapSummaryVotes", { count: card.votesCast }), t("sharing.recapSummaryBooks", { count: card.booksInPlay })].join("\n");
    case "hottestGame": return gameScoreLabel(card.game, locale);
    case "dailyChapter": return [
      t("sharing.recapDailyPlayed", { count: card.players }),
      ...(card.hardest ? [t("sharing.recapHardest", { title: card.hardest.title, average: decimalText(card.hardest.average, locale) })] : []),
      ...(card.mostMissed ? [t("sharing.recapMostMissed", { title: card.mostMissed.title, percent: card.mostMissed.missedPercent })] : []),
      ...(card.topPlayers.length ? [t("sharing.recapMostPerfect", { players: card.topPlayers.map((p) => `@${p.username} (${p.perfect})`).join(", ") })] : []),
    ].join("\n");
    case "book": return valueLabel(card.board, card.book.value, locale);
  }
}

export function recapCta(card: TopShelfRecapCard, currentMonth: string, locale: Locale): string {
  const t = translatorFor(locale);
  switch (card.kind) {
    case "summary": return t("sharing.recapCtaSummary");
    case "dailyChapter": return t("sharing.recapCtaDaily");
    case "hottestGame": return t(card.open ? "sharing.recapCtaPlayYourself" : "sharing.recapCtaSeeHowItEnded");
    case "book": return card.game ? t(VOTE_CTAS[card.game.content.kind], { month: recapMonthName(currentMonth, locale) }) : t("sharing.recapCtaBook", { title: card.book.title });
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
