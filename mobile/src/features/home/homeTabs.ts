const ALL_HOME_TABS = [
  { value: "activity", label: "Activity" },
  { value: "discover", label: "Discover" },
  { value: "people", label: "Find people" },
] as const;

export type HomeTab = (typeof ALL_HOME_TABS)[number]["value"];

export function homeTabOptions(newCount: number): Array<{ value: HomeTab; label: string; badge?: number; accessibilityLabel?: string }> {
  return ALL_HOME_TABS.map((tab) =>
    tab.value === "activity" && newCount > 0
      ? { ...tab, badge: newCount, accessibilityLabel: `${tab.label}, ${newCount} new` }
      : { ...tab },
  );
}

/** A feed with nothing in it is a dead end on the tab it would otherwise
 *  open on, so an empty Activity opens on Discover instead. */
export function defaultHomeTab(activityItemCount: number): HomeTab {
  return activityItemCount === 0 ? "discover" : "activity";
}
