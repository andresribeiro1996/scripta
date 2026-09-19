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

export function activityText(item: ActivityItem): { verb: string; target: string; href: string | null } {
  switch (item.type) {
    case "tierlist_published":
      return { verb: "Published a tierlist", target: String(item.payload.name ?? ""), href: (item.payload.href as string | undefined) ?? null };
    case "tournament_published":
      return { verb: "Published a tournament", target: String(item.payload.name ?? ""), href: (item.payload.href as string | undefined) ?? null };
    case "book_added":
      return { verb: "Added", target: `${String(item.payload.title ?? "")} — ${statusLabel(Number(item.payload.status ?? 0))}`, href: null };
    case "book_finished":
      return { verb: "Finished", target: String(item.payload.title ?? ""), href: null };
    case "following":
      return { verb: "Followed", target: `@${String(item.payload.username ?? "")}`, href: null };
    case "mural_published":
      return { verb: "Published", target: "a mural", href: null };
    case "voted_on":
      return item.payload.game === "tierlist"
        ? { verb: "Ranked books on", target: String(item.payload.name ?? ""), href: null }
        : { verb: "Voted in", target: String(item.payload.name ?? ""), href: null };
  }
}
