import { Stack } from "expo-router";
import { useScreenOptions, useSheetOptions } from "@/ui/navigation";

// Without this, tapping the Library tab landed on whichever screen in this
// group Expo Router picked as its default (add-book) instead of the grid.
export const unstable_settings = {
  initialRouteName: "library",
};

export default function LibraryStackLayout() {
  const sheet = useSheetOptions();
  return (
    <Stack screenOptions={useScreenOptions()}>
      {/* Declared first, and that position is what actually anchors the tab:
          expo-router's getSortedChildren emits declared screens in this order
          and appends undeclared ones after, so whichever is listed first here
          becomes the stack's initial route. unstable_settings above cannot do
          it alone — layouts/Stack.js never forwards that anchor to React
          Navigation, it only sorts the routes left undeclared. */}
      <Stack.Screen name="library" />
      {/* `presentation` is read when the screen is presented, so it has to be
          declared here — a <Stack.Screen> inside the route component renders
          too late to change how that screen was pushed. Those inline blocks
          set only the titles, which do update. */}
      <Stack.Screen name="add-book" options={{ ...sheet, title: "Add a book" }} />
      <Stack.Screen name="import" options={{ ...sheet, title: "Import library" }} />
      <Stack.Screen name="reorder" options={{ ...sheet, title: "Reorder books" }} />
      <Stack.Screen name="share" options={{ ...sheet, title: "Share library" }} />
      <Stack.Screen name="book/[key]/index" options={{ ...sheet, title: "Book details" }} />
      <Stack.Screen name="collection/[id]" options={{ ...sheet, title: "Collection" }} />
      <Stack.Screen name="book/[key]/style" options={{ ...sheet, title: "Card style" }} />
      <Stack.Screen name="book/[key]/cover" options={{ ...sheet, title: "Cover" }} />
    </Stack>
  );
}
