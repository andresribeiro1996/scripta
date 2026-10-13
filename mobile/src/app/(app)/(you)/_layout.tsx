import { Stack } from "expo-router";
import { useScreenOptions, useSheetOptions } from "@/ui/navigation";

export const unstable_settings = {
  initialRouteName: "you",
};

export default function YouStackLayout() {
  const sheet = useSheetOptions();
  return (
    <Stack screenOptions={useScreenOptions()}>
      <Stack.Screen name="you" />
      <Stack.Screen name="add-book" options={{ ...sheet, title: "Add a book" }} />
      <Stack.Screen name="import" options={{ ...sheet, title: "Import library" }} />
      <Stack.Screen name="book/[key]/index" options={{ title: "" }} />
      <Stack.Screen name="book/[key]/style" options={{ ...sheet, title: "Card style" }} />
      <Stack.Screen name="book/[key]/cover" options={{ ...sheet, title: "Cover" }} />
      <Stack.Screen name="book/[key]/finished" options={{ ...sheet, title: "Finished" }} />
    </Stack>
  );
}
