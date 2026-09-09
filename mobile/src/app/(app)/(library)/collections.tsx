import { Stack } from "expo-router";
import { GroupsView } from "@/features/library/components/GroupsView";
import { Screen } from "@/ui";

export default function CollectionsRoute() {
  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: "Collections" }} />
      <GroupsView type="collection" />
    </Screen>
  );
}
