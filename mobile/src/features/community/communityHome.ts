import { activityRow, contentDetail, contentKindLabel, contentStats, contentStatus, contentTarget, feedHeading, feedTarget, gameActionLabel, TIER_LADDER, type ActivityItem } from "@scripta/shared/community";
import { getLocale } from "../../i18n";

export const FAN_SIZE = 3;

export { contentDetail, contentKindLabel, contentStats, contentStatus, contentTarget, feedHeading, feedTarget, gameActionLabel, TIER_LADDER };

export const DISCOVER_FILTERS = [
  { value: "all", label: "All" },
  { value: "tierlist", label: "Tier lists" },
  { value: "tournament", label: "Tournaments" },
  { value: "quiz", label: "Quizzes" },
] as const;

export type DiscoverFilter = (typeof DISCOVER_FILTERS)[number]["value"];

export function renderableActivity(items: ActivityItem[]): ActivityItem[] {
  const locale = getLocale();
  return items.filter((item) => activityRow(item, locale) !== null);
}
