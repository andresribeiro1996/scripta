import { Stack } from "expo-router";
import { GroupsView } from "@/features/library/components/GroupsView";
import { Screen } from "@/ui";

export default function SeriesRoute() {
  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: "Series" }} />
      <GroupsView type="series" />
    </Screen>
  );
}
