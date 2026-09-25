import { useRef, useState } from "react";
import { Stack } from "expo-router";
import type { SearchBarCommands } from "react-native-screens";
import { GroupsView, type GroupsViewHandle } from "@/features/library/components/GroupsView";
import { IconButton, Screen } from "@/ui";

export default function CollectionsRoute() {
  const [search, setSearch] = useState("");
  const searchBar = useRef<SearchBarCommands>(null);
  const groupsView = useRef<GroupsViewHandle>(null);

  return (
    <Screen top={false}>
      <Stack.Screen
        options={{
          title: "Collections",
          headerSearchBarOptions: {
            ref: searchBar,
            autoCapitalize: "none",
            placeholder: "Search collections",
            hideWhenScrolling: true,
            onChangeText: (event) => setSearch(event.nativeEvent.text),
            onCancelButtonPress: () => setSearch(""),
          },
          headerRight: () => <IconButton framed accessibilityLabel="New collection" label="New" name="add" onPress={() => groupsView.current?.startCreating()} />,
        }}
      />
      <GroupsView ref={groupsView} search={search} />
    </Screen>
  );
}
