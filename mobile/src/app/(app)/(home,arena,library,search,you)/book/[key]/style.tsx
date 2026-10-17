import { router, Stack, useLocalSearchParams } from "expo-router";
import type { PerCardStyle } from "@scripta/shared";
import { PerCardStyleForm } from "@/features/library/components/PerCardStyleForm";
import { useBook } from "@/features/library/hooks/useBook";
import { useLibraryActions } from "@/features/library/hooks/useLibraryActions";
import { ErrorState, Screen, SheetHeader, Skeleton } from "@/ui";
import { spacing, useTheme } from "@/ui/theme";

export default function BookStyleRoute() {
  const { colors } = useTheme();
  const { key } = useLocalSearchParams<{ key: string }>();
  const { book, seedStyle, inheritedFrom, loading } = useBook(key);
  const { saveBookStyle } = useLibraryActions();
  const name = String(book?.Title ?? "");
  const title = "Card style";

  return (
    <Screen top={false} style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
      <Stack.Screen options={{ title, headerShown: false, sheetAllowedDetents: [0.85, 1], contentStyle: { backgroundColor: colors.background } }} />
      <SheetHeader title={title} onClose={() => router.back()} />
      {loading ? (
        <Skeleton height={180} />
      ) : !book ? (
        <ErrorState title="Book not found" actionLabel="Close" onAction={() => router.back()} />
      ) : (
        <PerCardStyleForm
          key={key}
          name={name}
          inheritedFrom={inheritedFrom}
          currentOverride={book._style as PerCardStyle | undefined}
          seedStyle={seedStyle}
          previewBook={book}
          onSave={(style) => void saveBookStyle(book, style)}
          onClose={() => router.back()}
        />
      )}
    </Screen>
  );
}
