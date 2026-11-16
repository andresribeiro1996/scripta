import { contentStatusBadge, type ContentTone } from "../community/helpers.js";
import type { Locale } from "../i18n/locale.js";
import { sharedT } from "../i18n/sharedT.js";

export type Badge = { label: string; tone: ContentTone };

export function tournamentBadge(t: { status: "seeding" | "active" | "completed"; currentRound?: number | null }, locale: Locale): Badge {
  if (t.status === "seeding") return { label: sharedT(locale)("shared.gamesList.seeding"), tone: "neutral" };
  if (t.status === "completed") return contentStatusBadge("completed", locale);
  if (t.currentRound && t.currentRound > 0) return { label: sharedT(locale)("shared.gamesList.round", { number: t.currentRound }), tone: "accent" };
  return contentStatusBadge("inProgress", locale);
}

export function gameStage(voteCode: string | null, open: boolean): "draft" | "open" | "closed" {
  return !voteCode ? "draft" : open ? "open" : "closed";
}

export function votedTierlistBadges(t: { votingOpen: boolean }, locale: Locale): Badge[] {
  return [contentStatusBadge(t.votingOpen ? "votingOpen" : "closed", locale), contentStatusBadge("voted", locale)];
}

export function gamesSections<O extends { name: string }, V extends { name: string }>(input: {
  owned: O[];
  voted: V[] | null;
  search: string;
  owner: "all" | "mine" | "voted";
}): { created: O[]; voted: V[] } {
  const needle = input.search.trim().toLowerCase();
  const matches = (item: { name: string }) => !needle || item.name.toLowerCase().includes(needle);
  return {
    created: input.owner === "voted" ? [] : input.owned.filter(matches),
    voted: input.owner === "mine" || !input.voted ? [] : input.voted.filter(matches),
  };
}
