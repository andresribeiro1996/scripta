import { Stack } from "expo-router";
import { Screen } from "../../ui";
import { PeoplePane } from "./PeoplePane";

export function PeopleScreen() {
  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: "People", headerShown: true }} />
      <PeoplePane />
    </Screen>
  );
}
