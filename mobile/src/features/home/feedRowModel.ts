import { contentDetail, contentKindLabel, relativeTime } from "@scripta/shared/community";
import { digestHeading, participationLead, readerGlyphLabel, type DigestItem } from "@scripta/shared";
import type { IconName } from "../../ui";

export interface FeedRowModel {
  /** Covers for the leading slot, widest first in the fan. Empty means the
   *  slot falls back to the actor's avatar. */
  covers: string[];
  /** Names the kind of thing the event is about, beside the label that says
   *  what happened to it. */
  icon: IconName;
  label: string;
  /** Accent for a publication or a vote, dim for an event that is only about
   *  its actor, success for a book someone finished. */
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
        icon: item.content.kind === "tierlist" ? "tierlist" : "arena",
        label: contentKindLabel(item.content),
        tone: "accent",
        title: item.content.name,
        detail: contentDetail(item.content),
        action: null
      };
    case "vote":
      return {
        covers: [],
        icon: "vote",
        label: item.content.kind === "tierlist" ? "Ranked" : "Voted",
        tone: "accent",
        title: "",
        detail: item.content.name,
        action: null
      };
    case "reading":
      return {
        covers: item.book.coverUrl ? [item.book.coverUrl] : [],
        icon: "book",
        label: item.finished ? "Finished" : "Added",
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
  }
}
