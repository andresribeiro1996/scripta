import { useMemo } from "react";
import { router, Stack } from "expo-router";
import { orderLibraryBooks } from "@scripta/shared";
import { ReorderList } from "@/features/library/components/ReorderList";
import { useLibrary } from "@/features/library/hooks/useLibrary";
import { useLibraryActions } from "@/features/library/hooks/useLibraryActions";
import { Screen, SheetHeader } from "@/ui";

export default function ReorderRoute() {
  const { data: library } = useLibrary();
  const { reorder } = useLibraryActions();
  // The library's own order, not the grid's filtered view — reordering a
  // filtered list would move books against positions the user cannot see.
  const ordered = useMemo(
    () => orderLibraryBooks(library?.data.books ?? [], library?.data.groups ?? []),
    [library],
  );
  return (
    <Screen top={false}>
      <Stack.Screen options={{ headerShown: false }} />
      <SheetHeader title="Reorder books" onClose={() => router.back()} />
      <ReorderList orderedBooks={ordered} onMove={reorder} onClose={() => router.back()} />
    </Screen>
  );
}
