import { Stack } from "expo-router";
import { useScreenOptions, useSheetOptions } from "@/ui/navigation";

export const unstable_settings = {
  initialRouteName: "index",
};

export default function HomeLayout() {
  const sheet = useSheetOptions();
  return (
    <Stack screenOptions={useScreenOptions()}>
      <Stack.Screen name="index" />
      <Stack.Screen name="book/[key]/index" options={{ ...sheet, title: "Book details" }} />
      <Stack.Screen name="book/[key]/style" options={{ ...sheet, title: "Card style" }} />
      <Stack.Screen name="book/[key]/cover" options={{ ...sheet, title: "Cover" }} />
    </Stack>
  );
}
