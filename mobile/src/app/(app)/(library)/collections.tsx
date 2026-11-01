import { useRef, useState } from "react";
import { Stack } from "expo-router";
import { GroupsView, TYPE_FILTER_OPTIONS, type GroupsViewHandle, type TypeFilter } from "@/features/library/components/GroupsView";
import { useT } from "@/i18n";
import { IconButton, Screen, SearchDock, searchDockClearance } from "@/ui";

export default function CollectionsRoute() {
  const t = useT();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const groupsView = useRef<GroupsViewHandle>(null);
  const typeFilterIndex = TYPE_FILTER_OPTIONS.findIndex((option) => option.value === typeFilter);
  const typeFilterOption = TYPE_FILTER_OPTIONS[typeFilterIndex];
  const nextTypeFilter = TYPE_FILTER_OPTIONS[(typeFilterIndex + 1) % TYPE_FILTER_OPTIONS.length];

  return (
    <Screen top={false}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerRight: () => <IconButton accessibilityLabel={t("shell.newCollection")} name="add" onPress={() => groupsView.current?.startCreating()} />,
        }}
      />
      <SearchDock
        accessibilityLabel={t("shell.searchCollections")}
        placeholder={t("shell.searchCollections")}
        value={search}
        onChangeText={setSearch}
        cycle={{
          icon: typeFilterOption.icon,
          active: typeFilter !== "all",
          accessibilityLabel: t("shell.showingType", { type: t(typeFilterOption.labelKey).toLowerCase() }),
          accessibilityHint: t("shell.switchesToNextType"),
          onPress: () => setTypeFilter(nextTypeFilter.value),
        }}
      >
        {(scrollProps) => <GroupsView ref={groupsView} search={search} typeFilter={typeFilter} bottomInset={searchDockClearance} {...scrollProps} />}
      </SearchDock>
    </Screen>
  );
}
