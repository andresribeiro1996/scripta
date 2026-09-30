import { Stack } from "expo-router";
import { Screen } from "../../ui";
import { DiscoverPane } from "./DiscoverPane";

export function DiscoverScreen({ inTabs }: { inTabs: boolean }) {
  return (
    <Screen bottom={!inTabs} top={false}>
      <Stack.Screen options={{ headerShown: true, title: "Discover" }} />
      <DiscoverPane linkAuthors={inTabs} />
    </Screen>
  );
}
