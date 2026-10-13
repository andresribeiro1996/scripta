import { useRef, useState } from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { GroupsView, TYPE_FILTER_OPTIONS, type GroupsViewHandle, type TypeFilter } from "@/features/library/components/GroupsView";
import { CycleButton, IconButton, Screen, SearchDock, dockClearance, useDockScroll } from "@/ui";

export default function CollectionsRoute() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const { scrolling, scrollProps } = useDockScroll();
  const groupsView = useRef<GroupsViewHandle>(null);

  return (
    <Screen top={false}>
      <Stack.Screen
        options={{
          title: "Collections",
          headerRight: () => <IconButton framed accessibilityLabel="New collection" label="New" name="add" onPress={() => groupsView.current?.startCreating()} />,
        }}
      />
      <View style={{ flex: 1 }}>
        <GroupsView ref={groupsView} search={search} typeFilter={typeFilter} bottomInset={dockClearance} {...scrollProps} />
        <SearchDock
          hidden={scrolling}
          accessibilityLabel="Search collections"
          placeholder="Search collections"
          value={search}
          onChangeText={setSearch}
          trailing={<CycleButton options={TYPE_FILTER_OPTIONS} value={typeFilter} onChange={setTypeFilter} />}
        />
      </View>
    </Screen>
  );
}
