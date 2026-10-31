import { digestHeading, digestTarget, participationLead, participationVerb, type DigestBook, type DigestItem } from "../dashboard.js";
import { isCertainMatch } from "../library/bookMatch.js";
import { sharedT } from "../i18n/sharedT.js";
import type { Locale } from "../i18n/locale.js";
import { readerGlyphLabel } from "../readerCards/card.js";
import { contentDetail, contentKindLabel, feedAction } from "./helpers.js";

export type FeedIconName = "tierlist" | "champion" | "arena" | "vote" | "book" | "follow" | "bracket" | "murals";

export interface FeedRowModel {
  /** Covers for the leading slot, widest first in the fan. Empty means the
   *  slot falls back to avatars: the actor's, or a participation row's
   *  participants, or a group icon when it names no one. */
  covers: string[];
  /** Names the kind of thing the event is about, beside the label that says
   *  what happened to it. */
  icon: FeedIconName;
  label: string;
  /** Accent for a publication, a vote or someone taking part in your game,
   *  dim for an event that is only about its actor, success for a book
   *  someone finished. */
  tone: "accent" | "dim" | "success";
  /** The line a reader scans for. Empty when the event is its own headline —
   *  a follow or a vote says everything in one sentence. */
  title: string;
  detail?: string;
  /** The one thing worth doing from the row itself. Null for every row whose
   *  only useful action is the tap that opens it. */
  action: "followBack" | null;
}

export function feedRowAccessibilityLabel(item: DigestItem, locale: Locale): string {
  const heading = digestHeading(item, locale);
  if (item.kind === "participation") return heading;
  const label = readerGlyphLabel(item.actor.readerGlyph);
  return label ? `${heading}, ${label}` : heading;
}

export function feedRowModel(item: DigestItem, locale: Locale): FeedRowModel {
  const t = sharedT(locale);
  switch (item.kind) {
    case "publication":
      return {
        covers: item.content.covers,
        icon: item.content.kind === "tierlist" ? "tierlist" : item.content.kind === "quiz" ? "champion" : "arena",
        label: contentKindLabel(item.content, locale),
        tone: "accent",
        title: item.content.name,
        detail: contentDetail(item.content, locale),
        action: null
      };
    case "vote":
      return {
        covers: [],
        icon: item.content.kind === "quiz" ? "champion" : "vote",
        label: t(item.content.kind === "tierlist" ? "shared.feedRowModel.ranked" : item.content.kind === "quiz" ? "shared.feedRowModel.played" : "shared.feedRowModel.voted"),
        tone: "accent",
        title: "",
        detail: item.content.name,
        action: null
      };
    case "reading":
      return {
        covers: item.book.coverUrl ? [item.book.coverUrl] : [],
        icon: "book",
        label: t(item.finished ? "shared.feedRowModel.finished" : item.started ? "shared.feedRowModel.started" : "shared.feedRowModel.added"),
        tone: item.finished ? "success" : "dim",
        title: item.book.title,
        detail: item.book.author || undefined,
        action: null
      };
    case "follow":
      // Offered only one way round: following back is the reply to being
      // followed, and there is nothing to offer once it is mutual.
      return { covers: [], icon: "follow", label: t("shared.feedRowModel.newFollower"), tone: "dim", title: "", action: item.viewerFollows ? null : "followBack" };
    case "participation":
      return {
        covers: item.game.covers,
        icon: item.game.kind === "tierlist" ? "tierlist" : item.game.kind === "tournament" ? "bracket" : "champion",
        label: t(item.game.kind === "tierlist" ? "shared.feedRowModel.ranked" : item.game.kind === "tournament" ? "shared.feedRowModel.voted" : "shared.feedRowModel.played"),
        tone: "accent",
        title: item.game.name,
        detail: participationLead(item, locale),
        action: null
      };
    case "mural":
      return { covers: item.mural.coverImageUrl ? [item.mural.coverImageUrl] : [], icon: "murals", label: t("shared.feedRowModel.mural"), tone: "accent", title: item.mural.name, action: null };
    case "completion":
      return { covers: item.winner.coverUrl ? [item.winner.coverUrl] : [], icon: "champion", label: t("shared.feedRowModel.tournamentFinished"), tone: "accent", title: t("shared.feedRowModel.winnerIs", { title: item.winner.title }), detail: t("shared.feedRowModel.tournamentBooks", { name: item.tournament.name, count: item.tournament.bracketSize }), action: null };
  }
}

export function feedEventLabel(item: DigestItem, locale: Locale): string {
  const t = sharedT(locale);
  if (item.kind === "publication") return feedAction(item, locale);
  if (item.kind === "vote") return t(item.content.kind === "tierlist" ? "shared.feedRowModel.eventRankedTierlist" : item.content.kind === "quiz" ? "shared.feedRowModel.eventPlayedQuiz" : "shared.feedRowModel.eventVotedTournament");
  if (item.kind === "reading") return t(item.finished ? "shared.feedRowModel.eventFinishedReading" : item.started ? "shared.feedRowModel.eventStartedReading" : "shared.feedRowModel.eventAddedToLibrary");
  if (item.kind === "mural") return t("shared.feedRowModel.eventPublishedMural");
  if (item.kind === "follow") return t("shared.feedRowModel.eventFollowed");
  if (item.kind === "completion") return t("shared.feedRowModel.eventCompletion");
  return participationVerb(item, locale);
}

export function feedPrimaryLabel(item: DigestItem, locale: Locale): string | null {
  const t = sharedT(locale);
  if (item.kind === "completion") return t("shared.feedRowModel.viewFinalBracket");
  if (item.kind === "mural") return t("shared.feedRowModel.openMural");
  if (item.kind === "publication") {
    const content = item.content;
    return t(content.kind === "tierlist" ? content.votingOpen ? "shared.feedRowModel.rankThisList" : "shared.helpers.viewRankings" : content.kind === "quiz" ? content.playOpen ? "shared.helpers.playQuiz" : "shared.helpers.viewQuiz" : content.status === "active" ? "shared.helpers.voteInTournament" : "shared.feedRowModel.viewFinalBracket");
  }
  if (item.kind === "vote") return t(item.content.kind === "tierlist" ? "shared.feedRowModel.viewTierlist" : item.content.kind === "quiz" ? "shared.helpers.playQuiz" : "shared.feedRowModel.viewTournament");
  if (item.kind === "participation") return t(item.game.kind === "tierlist" ? "shared.helpers.viewRankings" : item.game.kind === "quiz" ? "shared.helpers.viewResults" : "shared.feedRowModel.viewTournament");
  return null;
}

export function readingShelfBook(book: DigestBook, books: Array<Record<string, unknown>>) {
  return books.find((entry) => isCertainMatch(entry, { Title: book.title, Attribution: book.author, ISBN: book.isbn ?? "" }));
}

export function feedShareTarget(item: DigestItem): string | null {
  if (item.kind === "follow" || item.kind === "mural" || (item.kind === "reading" && !item.book.workId)) return null;
  if (item.kind !== "participation") return digestTarget(item);
  if (item.game.kind === "tournament") return `/arena/${item.game.id}`;
  return item.game.voteCode ? `/${item.game.kind === "tierlist" ? "vote" : "play"}/${item.game.voteCode}` : null;
}

export function hasActivityThread(item: DigestItem): boolean {
  return item.kind !== "participation" && item.kind !== "completion" && item.kind !== "follow" && !item.id.startsWith("saved:");
}

export function reactionCount(count: number | undefined): string | null {
  return count === undefined ? "…" : count === 0 ? null : String(count);
}
