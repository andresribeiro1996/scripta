import { contentDetail, contentKindLabel, relativeTime } from "@scripta/shared/community";
import { digestHeading, digestTarget, isCertainMatch, participationLead, readerGlyphLabel, type DigestBook, type DigestItem } from "@scripta/shared";
import type { IconName } from "../../ui";

export interface FeedRowModel {
  /** Covers for the leading slot, widest first in the fan. Empty means the
   *  slot falls back to avatars: the actor's, or a participation row's
   *  participants, or a group icon when it names no one. */
  covers: string[];
  /** Names the kind of thing the event is about, beside the label that says
   *  what happened to it. */
  icon: IconName;
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

export { relativeTime };

export function feedRowAccessibilityLabel(item: DigestItem): string {
  const heading = digestHeading(item);
  if (item.kind === "participation") return heading;
  const label = readerGlyphLabel(item.actor.readerGlyph);
  return label ? `${heading}, ${label}` : heading;
}

export function feedRowModel(item: DigestItem): FeedRowModel {
  switch (item.kind) {
    case "publication":
      return {
        covers: item.content.covers,
        icon: item.content.kind === "tierlist" ? "tierlist" : item.content.kind === "quiz" ? "champion" : "arena",
        label: contentKindLabel(item.content),
        tone: "accent",
        title: item.content.name,
        detail: contentDetail(item.content),
        action: null
      };
    case "vote":
      return {
        covers: [],
        icon: item.content.kind === "quiz" ? "champion" : "vote",
        label: item.content.kind === "tierlist" ? "Ranked" : item.content.kind === "quiz" ? "Played" : "Voted",
        tone: "accent",
        title: "",
        detail: item.content.name,
        action: null
      };
    case "reading":
      return {
        covers: item.book.coverUrl ? [item.book.coverUrl] : [],
        icon: "book",
        label: item.finished ? "Finished" : item.started ? "Started" : "Added",
        tone: item.finished ? "success" : "dim",
        title: item.book.title,
        detail: item.book.author || undefined,
        action: null
      };
    case "follow":
      // Offered only one way round: following back is the reply to being
      // followed, and there is nothing to offer once it is mutual.
      return { covers: [], icon: "follow", label: "New follower", tone: "dim", title: "", action: item.viewerFollows ? null : "followBack" };
    case "participation":
      return {
        covers: item.game.covers,
        icon: item.game.kind === "tierlist" ? "tierlist" : item.game.kind === "tournament" ? "bracket" : "champion",
        label: item.game.kind === "tierlist" ? "Ranked" : item.game.kind === "tournament" ? "Voted" : "Played",
        tone: "accent",
        title: item.game.name,
        detail: participationLead(item),
        action: null
      };
    case "mural":
      return { covers: item.mural.coverImageUrl ? [item.mural.coverImageUrl] : [], icon: "murals", label: "Mural", tone: "accent", title: item.mural.name, action: null };
    case "completion":
      return { covers: item.winner.coverUrl ? [item.winner.coverUrl] : [], icon: "champion", label: "Tournament finished", tone: "accent", title: `${item.winner.title} is the winner`, detail: `${item.tournament.name} · ${item.tournament.bracketSize} books`, action: null };
  }
}

// Mobile's profile route is /u/<name>; the shared target is the web app's
// /community/u/<name>, so the two kinds that point at a person are remapped.
// A participation row's tier list or quiz is remapped too, from the web
// dashboard's /dashboard/arena/<kind>/<id> to its own native screen.
export function digestRoute(item: DigestItem): string {
  if (item.kind === "participation") return item.game.kind === "tournament" ? `/arena/${item.game.id}` : `/${item.game.kind}/${item.game.id}`;
  if (item.kind === "reading") return item.book.workId ? `/work/${item.book.workId}` : `/u/${item.actor.username}`;
  if (item.kind === "follow") return `/u/${item.actor.username}`;
  if (item.kind === "mural") return `/u/${item.actor.username}`;
  return digestTarget(item);
}

export function feedEventLabel(item: DigestItem): string {
  if (item.kind === "publication") return `published a ${contentKindLabel(item.content).toLowerCase()}`;
  if (item.kind === "vote") return item.content.kind === "tierlist" ? "ranked a tier list" : item.content.kind === "quiz" ? "played a quiz" : "voted in a tournament";
  if (item.kind === "reading") return item.finished ? "finished reading" : item.started ? "started reading" : "added to their library";
  if (item.kind === "mural") return "published a mural";
  if (item.kind === "follow") return "followed you";
  if (item.kind === "completion") return "A tournament you joined has finished";
  return item.game.kind === "tierlist" ? "ranked your tier list" : item.game.kind === "quiz" ? "played your quiz" : "voted in your tournament";
}

export function feedPrimaryLabel(item: DigestItem): string | null {
  if (item.kind === "completion") return "View final bracket";
  if (item.kind === "mural") return "Open mural";
  if (item.kind === "publication") {
    const content = item.content;
    return content.kind === "tierlist" ? content.votingOpen ? "Rank this list" : "View rankings" : content.kind === "quiz" ? content.playOpen ? "Play quiz" : "View quiz" : content.status === "active" ? "Vote in tournament" : "View final bracket";
  }
  if (item.kind === "vote") return item.content.kind === "tierlist" ? "View tier list" : item.content.kind === "quiz" ? "Play quiz" : "View tournament";
  if (item.kind === "participation") return item.game.kind === "tierlist" ? "View rankings" : item.game.kind === "quiz" ? "View results" : "View tournament";
  return null;
}

export function readingShelfBook(book: DigestBook, books: Array<Record<string, unknown>>) {
  return books.find((entry) => isCertainMatch(entry, { Title: book.title, Attribution: book.author, ISBN: book.isbn ?? "" }));
}

export function feedShareTarget(item: DigestItem): string | null {
  if (item.kind !== "participation") return digestTarget(item);
  if (item.game.kind === "tournament") return `/arena/${item.game.id}`;
  return item.game.voteCode ? `/${item.game.kind === "tierlist" ? "vote" : "play"}/${item.game.voteCode}` : null;
}

export function hasActivityThread(item: DigestItem): boolean {
  return item.kind !== "participation" && item.kind !== "completion" && item.kind !== "follow" && !item.id.startsWith("saved:");
}
