import { Stack } from "expo-router";
import { sheetOptions, useScreenOptions } from "@/ui/navigation";

export default function LibraryStackLayout() {
  return (
    <Stack screenOptions={useScreenOptions()}>
      {/* `presentation` is read when the screen is presented, so it has to be
          declared here — a <Stack.Screen> inside the route component renders
          too late to change how that screen was pushed. Those inline blocks
          set only the titles, which do update. */}
      <Stack.Screen name="add-book" options={sheetOptions("Add a book")} />
      <Stack.Screen name="import" options={sheetOptions("Import library")} />
      <Stack.Screen name="reorder" options={sheetOptions("Reorder books")} />
      <Stack.Screen name="share" options={sheetOptions("Share library")} />
      <Stack.Screen name="book/[key]/index" options={sheetOptions("Book details")} />
      <Stack.Screen name="book/[key]/style" options={sheetOptions("Card style")} />
      <Stack.Screen name="book/[key]/cover" options={sheetOptions("Cover")} />
    </Stack>
  );
}
