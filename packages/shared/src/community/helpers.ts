import { statusLabel } from "../library/covers.js";
import type {
  ActivityEventType,
  ActivityItem,
  FeedCategory,
  FeedSettings,
  FeedItem,
  PublishedContent
} from "./types.js";

export function contentKindLabel(content: PublishedContent): string {
  return content.kind === "tierlist" ? "Tier list" : "Tournament";
}

export function contentDetail(content: PublishedContent): string {
  if (content.kind === "tierlist") {
    return `${content.poolSize} books · ${content.ballotCount} ballots${content.promotedAt ? " · permanent reference" : content.votingOpen ? "" : " · closed"}`;
  }
  return `${content.bracketSize}-book bracket · ${content.status}`;
}

export type ContentTone = "neutral" | "accent" | "info" | "success" | "reference";

export function contentStatus(content: PublishedContent): { label: string; tone: ContentTone } {
  if (content.kind === "tournament") {
    return content.status === "active" ? { label: "In progress", tone: "info" } : { label: "Completed", tone: "success" };
  }
  if (content.promotedAt) return { label: "Reference", tone: "reference" };
  if (content.votingOpen && content.viewerVoted) return { label: "Voted", tone: "info" };
  return content.votingOpen ? { label: "Voting open", tone: "accent" } : { label: "Closed", tone: "neutral" };
}

export function contentStats(content: PublishedContent): Array<{ value: number; label: string }> {
  const books = content.kind === "tierlist" ? content.poolSize : content.bracketSize;
  const stats = [{ value: books, label: books === 1 ? "book" : "books" }];
  if (content.kind === "tierlist") stats.push({ value: content.ballotCount, label: content.ballotCount === 1 ? "ballot" : "ballots" });
  return stats;
}

export function contentTarget(content: PublishedContent): string {
  return content.kind === "tierlist" ? `/vote/${content.voteCode}` : `/arena/${content.id}`;
}

export function feedTarget(item: FeedItem): string {
  return contentTarget(item.content);
}

export function feedHeading(item: FeedItem): string {
  const noun = item.content.kind === "tierlist" ? "tier list" : "tournament";
  return `${item.actor.username} published a ${noun}`;
}

export const DEFAULT_FEED_SETTINGS: FeedSettings = {
  publications: true,
  reading: false,
  votes: true,
  follows: true
};

export function normalizeFeedSettings(value: unknown): FeedSettings | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const keys: FeedCategory[] = ["publications", "reading", "votes", "follows"];
  const out: Partial<FeedSettings> = {};
  for (const k of keys) {
    if (typeof v[k] !== "boolean") return null;
    out[k] = v[k] as boolean;
  }
  return out as FeedSettings;
}

export function categoryFor(type: ActivityEventType): FeedCategory {
  if (type === "book_added" || type === "book_finished") return "reading";
  if (type === "voted_on") return "votes";
  if (type === "following") return "follows";
  return "publications";
}

export interface ActivityRow {
  kind: "publication" | "vote" | "reading" | "follow" | "mural";
  label: string;
  tone: "accent" | "success" | "dim";
  title: string;
  meta: string;
  covers: string[];
  href: string | null;
  username: string | null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function covers(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((cover): cover is string => typeof cover === "string" && cover.length > 0).slice(0, 3) : [];
}

export function activityRow(item: ActivityItem): ActivityRow {
  const p = item.payload;
  const base = { covers: covers(p.covers), href: text(p.href) || null, username: null };
  switch (item.type) {
    case "tierlist_published":
      return { ...base, kind: "publication", label: "Published a tier list", tone: "accent", title: text(p.name), meta: text(p.detail) };
    case "tournament_published":
      return { ...base, kind: "publication", label: "Started a tournament", tone: "accent", title: text(p.name), meta: text(p.detail) };
    case "book_added": {
      const cover = text(p.coverUrl);
      return { ...base, kind: "reading", label: "Added to library", tone: "dim", title: text(p.title), meta: [text(p.author), statusLabel(Number(p.status ?? 0))].filter(Boolean).join(" · "), covers: cover ? [cover] : [] };
    }
    case "book_finished": {
      const cover = text(p.coverUrl);
      return { ...base, kind: "reading", label: "Finished reading", tone: "success", title: text(p.title), meta: text(p.author), covers: cover ? [cover] : [] };
    }
    case "following":
      return { ...base, kind: "follow", label: "Followed", tone: "dim", title: `@${text(p.username)}`, meta: "", username: text(p.username) || null };
    case "mural_published":
      return { ...base, kind: "mural", label: "Updated profile", tone: "accent", title: "Published a new profile mural", meta: "" };
    case "voted_on":
      return { ...base, kind: "vote", label: p.game === "tierlist" ? "Ranked a tier list" : "Voted in a tournament", tone: "accent", title: text(p.name), meta: "" };
  }
}

const DAY_MS = 86_400_000;

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

export function activityDay(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
}
