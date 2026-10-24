import { DEFAULT_TIER_PRESET } from "@scripta/shared";
import { activityRow, contentDetail, contentKindLabel, contentStats, contentStatus, contentTarget, feedHeading, feedTarget, type ActivityItem, type PublishedContent } from "@scripta/shared/community";

export const FAN_SIZE = 3;

export const TIER_LADDER = DEFAULT_TIER_PRESET.map((tier) => tier.color);

export { contentDetail, contentKindLabel, contentStats, contentStatus, contentTarget, feedHeading, feedTarget };

export const DISCOVER_FILTERS = [
  { value: "all", label: "All" },
  { value: "tierlist", label: "Tier lists" },
  { value: "tournament", label: "Tournaments" },
  { value: "quiz", label: "Quizzes" },
] as const;

export type DiscoverFilter = (typeof DISCOVER_FILTERS)[number]["value"];

export function gameActionLabel(content: PublishedContent): string {
  if (content.kind === "quiz") return content.playOpen && !content.viewerVoted ? "Play quiz" : "View quiz";
  if (content.kind === "tournament") return content.status === "completed" ? "View results" : "Vote in tournament";
  return content.promotedAt || !content.votingOpen ? "View rankings" : content.viewerVoted ? "Edit ranking" : "Rank books";
}

export function renderableActivity(items: ActivityItem[]): ActivityItem[] {
  return items.filter((item) => activityRow(item) !== null);
}
