import { contentDetail, contentKindLabel, contentTarget, feedHeading, feedTarget } from "@scripta/shared/community";

export { contentDetail, contentKindLabel, contentTarget, feedHeading, feedTarget };

export const DISCOVER_FILTERS = [
  { value: "all", label: "All" },
  { value: "tierlist", label: "Tier lists" },
  { value: "tournament", label: "Tournaments" },
] as const;

export type DiscoverFilter = (typeof DISCOVER_FILTERS)[number]["value"];
