import { useRef, useState } from "react";
import { Stack } from "expo-router";
import { GroupsView, type GroupsViewHandle } from "@/features/library/components/GroupsView";
import { IconButton, Screen } from "@/ui";

export default function CollectionsRoute() {
  const [search, setSearch] = useState("");
  const groupsView = useRef<GroupsViewHandle>(null);

  return (
    <Screen top={false}>
      <Stack.Screen
        options={{
          title: "Collections",
          headerRight: () => <IconButton framed accessibilityLabel="New collection" label="New" name="add" onPress={() => groupsView.current?.startCreating()} />,
        }}
      />
      <GroupsView ref={groupsView} search={search} onSearchChange={setSearch} />
    </Screen>
  );
}
