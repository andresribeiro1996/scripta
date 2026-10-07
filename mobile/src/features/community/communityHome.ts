import { activityRow, contentDetail, contentKindLabel, contentStats, contentStatus, contentTarget, feedHeading, feedTarget, type ActivityItem } from "@scripta/shared/community";

export { contentDetail, contentKindLabel, contentStats, contentStatus, contentTarget, feedHeading, feedTarget };

export const DISCOVER_FILTERS = [
  { value: "all", label: "All" },
  { value: "tierlist", label: "Tier lists" },
  { value: "tournament", label: "Tournaments" },
  { value: "quiz", label: "Quizzes" },
] as const;

export type DiscoverFilter = (typeof DISCOVER_FILTERS)[number]["value"];

export function renderableActivity(items: ActivityItem[]): ActivityItem[] {
  return items.filter((item) => activityRow(item) !== null);
}
