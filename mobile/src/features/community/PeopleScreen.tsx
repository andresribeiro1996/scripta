import { Stack } from "expo-router";
import { Screen } from "../../ui";
import { PeoplePane } from "./PeoplePane";
import { useT } from "../../i18n";

export function PeopleScreen() {
  const t = useT();
  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: t("book.people"), headerShown: true }} />
      <PeoplePane />
    </Screen>
  );
}
