import { contentDetail, contentKindLabel } from "@scripta/shared/community";
import type { DigestItem } from "@scripta/shared";
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
  meta: string;
  /** The one thing worth doing from the row itself. Null for every row whose
   *  only useful action is the tap that opens it. */
  action: "followBack" | null;
}

const DAY_MS = 86_400_000;

/** Relative for the span a feed is actually read over, absolute past it: "412d
 *  ago" is arithmetic the reader has to undo, while a date is just a date. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const elapsed = now - then;
  if (elapsed < 0) return "now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(elapsed / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(elapsed / DAY_MS);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
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
        meta: `${item.actor.username} · ${contentDetail(item.content)}`,
        action: null
      };
    case "vote":
      return {
        covers: [],
        icon: "vote",
        label: item.content.kind === "tierlist" ? "Ranked" : "Voted",
        tone: "accent",
        title: "",
        meta: `${item.actor.username} · ${item.content.name}`,
        action: null
      };
    case "reading":
      return {
        covers: item.book.coverUrl ? [item.book.coverUrl] : [],
        icon: "book",
        label: item.finished ? "Finished" : "Added",
        tone: item.finished ? "success" : "dim",
        title: item.book.title,
        meta: item.book.author ? `${item.actor.username} · ${item.book.author}` : item.actor.username,
        action: null
      };
    case "follow":
      // Offered only one way round: following back is the reply to being
      // followed, and there is nothing to offer once it is mutual.
      return { covers: [], icon: "follow", label: "New follower", tone: "dim", title: "", meta: item.actor.username, action: item.viewerFollows ? null : "followBack" };
  }
}
