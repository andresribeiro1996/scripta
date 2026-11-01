import { Stack } from "expo-router";
import { useT } from "@/i18n";
import { useScreenOptions, useSheetOptions } from "@/ui/navigation";

// Without this, tapping the Library tab landed on whichever screen in this
// group Expo Router picked as its default (add-book) instead of the library.
export const unstable_settings = {
  initialRouteName: "library",
};

export default function LibraryStackLayout() {
  const t = useT();
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
      <Stack.Screen name="add-book" options={{ ...sheet, title: t("shell.addBook") }} />
      <Stack.Screen name="import" options={{ ...sheet, title: t("shell.importLibrary") }} />
      <Stack.Screen name="reorder" options={{ ...sheet, title: t("shell.reorderBooks") }} />
      <Stack.Screen name="book/[key]/index" options={{ title: "" }} />
      <Stack.Screen name="collection/[id]" options={{ ...sheet, title: t("shell.collection") }} />
      <Stack.Screen name="book/[key]/style" options={{ ...sheet, title: t("shell.cardStyle") }} />
      <Stack.Screen name="book/[key]/cover" options={{ ...sheet, title: t("shell.cover") }} />
      <Stack.Screen name="book/[key]/finished" options={{ ...sheet, title: t("shell.finished") }} />
    </Stack>
  );
}
