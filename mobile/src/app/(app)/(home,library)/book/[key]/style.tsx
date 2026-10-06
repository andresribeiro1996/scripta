import { router, Stack, useLocalSearchParams } from "expo-router";
import type { PerCardStyle } from "@scripta/shared";
import { PerCardStyleForm } from "@/features/library/components/PerCardStyleForm";
import { useBook } from "@/features/library/hooks/useBook";
import { useLibraryActions } from "@/features/library/hooks/useLibraryActions";
import { ErrorState, Screen, Skeleton } from "@/ui";
import { spacing } from "@/ui/theme";

export default function BookStyleRoute() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { book, seedStyle, inheritedFrom, loading } = useBook(key);
  const { saveBookStyle } = useLibraryActions();
  const name = String(book?.Title ?? "");

  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: name ? `Style for "${name}"` : "Card style", sheetAllowedDetents: [0.85, 1], contentStyle: { paddingHorizontal: spacing.lg, paddingTop: spacing.md } }} />
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
