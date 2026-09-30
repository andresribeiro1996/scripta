import { Stack } from "expo-router";
import { Screen } from "../../ui";
import { DiscoverPane } from "./DiscoverPane";

export function DiscoverScreen() {
  return (
    <Screen bottom top={false}>
      <Stack.Screen options={{ headerShown: true, title: "Discover" }} />
      <DiscoverPane />
    </Screen>
  );
}
