import { Stack } from "expo-router";
import { useScreenOptions, useSheetOptions } from "@/ui/navigation";

export default function LibraryStackLayout() {
  const sheet = useSheetOptions();
  return (
    <Stack screenOptions={useScreenOptions()}>
      {/* `presentation` is read when the screen is presented, so it has to be
          declared here — a <Stack.Screen> inside the route component renders
          too late to change how that screen was pushed. Those inline blocks
          set only the titles, which do update. */}
      <Stack.Screen name="add-book" options={{ ...sheet, title: "Add a book" }} />
      <Stack.Screen name="import" options={{ ...sheet, title: "Import library" }} />
      <Stack.Screen name="reorder" options={{ ...sheet, title: "Reorder books" }} />
      <Stack.Screen name="share" options={{ ...sheet, title: "Share library" }} />
      <Stack.Screen name="book/[key]/index" options={{ ...sheet, title: "Book details" }} />
      <Stack.Screen name="book/[key]/style" options={{ ...sheet, title: "Card style" }} />
      <Stack.Screen name="book/[key]/cover" options={{ ...sheet, title: "Cover" }} />
    </Stack>
  );
}
