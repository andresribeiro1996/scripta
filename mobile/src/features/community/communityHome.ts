import type { Locale } from "@scripta/shared/i18n";
import { activityRow, contentDetail, contentKindLabel, contentStats, contentStatus, contentTarget, feedHeading, feedTarget, gameActionLabel, TIER_LADDER, type ActivityItem } from "@scripta/shared/community";
import type { MessageKey } from "../../i18n";

export const FAN_SIZE = 3;

export { contentDetail, contentKindLabel, contentStats, contentStatus, contentTarget, feedHeading, feedTarget, gameActionLabel, TIER_LADDER };

export const DISCOVER_FILTERS = [
  { value: "all", labelKey: "book.scopeAll" },
  { value: "tierlist", labelKey: "book.tierLists" },
  { value: "tournament", labelKey: "book.tournaments" },
  { value: "quiz", labelKey: "community.filterQuizzes" },
] as const satisfies readonly { value: string; labelKey: MessageKey }[];

export type DiscoverFilter = (typeof DISCOVER_FILTERS)[number]["value"];

export function renderableActivity(items: ActivityItem[], locale: Locale): ActivityItem[] {
  return items.filter((item) => activityRow(item, locale) !== null);
}
