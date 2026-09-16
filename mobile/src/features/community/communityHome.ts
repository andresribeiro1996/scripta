import type { DiscoverItem, FeedItem } from "@scripta/shared/community";

export const COMMUNITY_TABS = [
  { value: "feed", label: "Feed" },
  { value: "discover", label: "Discover" },
  { value: "people", label: "People" },
] as const;

export type CommunityTab = (typeof COMMUNITY_TABS)[number]["value"];

export const DISCOVER_FILTERS = [
  { value: "all", label: "All" },
  { value: "tierlist", label: "Tier lists" },
  { value: "tournament", label: "Tournaments" },
] as const;

export type DiscoverFilter = (typeof DISCOVER_FILTERS)[number]["value"];

type Content = DiscoverItem["content"];

export function contentKindLabel(content: Content): string {
  return content.kind === "tierlist" ? "Tier list" : "Tournament";
}

export function contentDetail(content: Content): string {
  if (content.kind === "tierlist") {
    return `${content.poolSize} books · ${content.ballotCount} ballots${content.votingOpen ? "" : " · closed"}`;
  }
  return `${content.bracketSize}-book bracket · ${content.status}`;
}

export function contentTarget(content: Content): string {
  return content.kind === "tierlist" ? `/vote/${content.voteCode}` : `/arena/${content.id}`;
}

export function feedTarget(item: FeedItem): string {
  return contentTarget(item.content);
}

export function feedHeading(item: FeedItem): string {
  const noun = item.content.kind === "tierlist" ? "tier list" : "tournament";
  return `${item.actor.username} published a ${noun}`;
}
