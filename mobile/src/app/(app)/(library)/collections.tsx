import { useRef, useState } from "react";
import { Stack } from "expo-router";
import { GroupsView, TYPE_FILTER_OPTIONS, type GroupsViewHandle, type TypeFilter } from "@/features/library/components/GroupsView";
import { IconButton, Screen, SearchDock, searchDockClearance } from "@/ui";

export default function CollectionsRoute() {
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
          headerRight: () => <IconButton framed accessibilityLabel="New collection" label="New" name="add" onPress={() => groupsView.current?.startCreating()} />,
        }}
      />
      <SearchDock
        accessibilityLabel="Search collections"
        placeholder="Search collections"
        value={search}
        onChangeText={setSearch}
        cycle={{
          icon: typeFilterOption.icon,
          active: typeFilter !== "all",
          accessibilityLabel: `Showing ${typeFilterOption.label.toLowerCase()}`,
          accessibilityHint: "Switches to the next type",
          onPress: () => setTypeFilter(nextTypeFilter.value),
        }}
      >
        {(scrollProps) => <GroupsView ref={groupsView} search={search} typeFilter={typeFilter} bottomInset={searchDockClearance} {...scrollProps} />}
      </SearchDock>
    </Screen>
  );
}
