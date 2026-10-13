export const COMMUNITY_TABS = [
  { value: "discover", label: "Discover" },
  { value: "people", label: "People" },
] as const;

export type CommunityTab = (typeof COMMUNITY_TABS)[number]["value"];

export function parseCommunityTab(value: string | undefined): CommunityTab {
  return COMMUNITY_TABS.find((tab) => tab.value === value)?.value ?? "people";
}
