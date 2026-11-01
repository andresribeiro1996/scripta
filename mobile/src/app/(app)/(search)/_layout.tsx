import { Stack } from "expo-router";
import { useT } from "@/i18n";
import { useScreenOptions, useSheetOptions } from "@/ui/navigation";

export const unstable_settings = {
  initialRouteName: "search",
};

export default function SearchStackLayout() {
  const t = useT();
  const sheet = useSheetOptions();
  return (
    <Stack screenOptions={useScreenOptions()}>
      <Stack.Screen name="search" />
      <Stack.Screen name="scan" options={{ title: t("shell.scan") }} />
      <Stack.Screen name="add-book" options={{ ...sheet, title: t("shell.addBook") }} />
      <Stack.Screen name="import" options={{ ...sheet, title: t("shell.importLibrary") }} />
      <Stack.Screen name="book/[key]/index" options={{ title: "" }} />
      <Stack.Screen name="book/[key]/style" options={{ ...sheet, title: t("shell.cardStyle") }} />
      <Stack.Screen name="book/[key]/cover" options={{ ...sheet, title: t("shell.cover") }} />
      <Stack.Screen name="book/[key]/finished" options={{ ...sheet, title: t("shell.finished") }} />
    </Stack>
  );
}
