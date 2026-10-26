import { useMemo, useState } from "react";
import { router, Stack } from "expo-router";
import { orderLibraryBooks } from "@scripta/shared";
import { ReorderList } from "@/features/library/components/ReorderList";
import { useLibrary } from "@/features/library/hooks/useLibrary";
import { useLibraryActions } from "@/features/library/hooks/useLibraryActions";
import { Screen, SheetHeader } from "@/ui";
import { Text } from "@/ui/Text";
import { spacing, typography, useTheme } from "@/ui/theme";

export default function ReorderRoute() {
  const { data: library } = useLibrary();
  const { colors } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const { reorder: saveOrder } = useLibraryActions(setError);
  const reorder = (key: string, direction: "up" | "down") => {
    setError(null);
    void saveOrder(key, direction);
  };
  // The library's own order, not the grid's filtered view — reordering a
  // filtered list would move books against positions the user cannot see.
  const groups = useMemo(() => library?.data.groups ?? [], [library]);
  const ordered = useMemo(() => orderLibraryBooks(library?.data.books ?? [], groups), [library, groups]);
  return (
    <Screen top={false}>
      <Stack.Screen options={{ headerShown: false }} />
      <SheetHeader title="Reorder books" onClose={() => router.back()} />
      {error ? <Text accessibilityRole="alert" style={[typography.caption, { color: colors.danger, paddingVertical: spacing.sm }]}>{error}</Text> : null}
      <ReorderList orderedBooks={ordered} groups={groups} onMove={reorder} onClose={() => router.back()} />
    </Screen>
  );
}
