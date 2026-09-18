import type { FeedItem, PublishedContent } from "./types.js";

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
