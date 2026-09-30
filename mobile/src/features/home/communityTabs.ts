const COMMUNITY_TABS = [
  { value: "activity", label: "Activity" },
  { value: "discover", label: "Discover" },
  { value: "people", label: "People" },
] as const;

export type CommunityTab = (typeof COMMUNITY_TABS)[number]["value"];

export function communityTabOptions(newCount: number): Array<{ value: CommunityTab; label: string; badge?: number; accessibilityLabel?: string }> {
  return COMMUNITY_TABS.map((tab) =>
    tab.value === "activity" && newCount > 0
      ? { ...tab, badge: newCount, accessibilityLabel: `${tab.label}, ${newCount} new` }
      : { ...tab },
  );
}

/** A feed with nothing in it is a dead end on the tab it would otherwise
 *  open on, so an empty Activity opens on Discover instead. */
export function defaultCommunityTab(activityItemCount: number): CommunityTab {
  return activityItemCount === 0 ? "discover" : "activity";
}

export function parseCommunityTab(value: string | undefined): CommunityTab | undefined {
  return COMMUNITY_TABS.find((tab) => tab.value === value)?.value;
}

export function shouldMarkSeen(tab: CommunityTab, loaded: boolean, loadFailed: boolean): boolean {
  return tab === "activity" && loaded && !loadFailed;
}
