import { Stack } from "expo-router";
import { Screen } from "../../ui";
import { DiscoverPane } from "./DiscoverPane";
import { useT } from "../../i18n";

export function DiscoverScreen() {
  const t = useT();
  return (
    <Screen bottom top={false}>
      <Stack.Screen options={{ headerShown: true, title: t("community.discover") }} />
      <DiscoverPane linkAuthors={false} />
    </Screen>
  );
}
