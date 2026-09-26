import { router, Stack, useLocalSearchParams } from "expo-router";
import type { PerCardStyle } from "@scripta/shared";
import { PerCardStyleForm } from "@/features/library/components/PerCardStyleForm";
import { useBook } from "@/features/library/hooks/useBook";
import { useLibraryActions } from "@/features/library/hooks/useLibraryActions";
import { ErrorState, Screen, Skeleton } from "@/ui";

export default function BookStyleRoute() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { book, seedStyle, loading } = useBook(key);
  const { saveBookStyle } = useLibraryActions();
  const name = String(book?.Title ?? "");

  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: name ? `Style for "${name}"` : "Card style" }} />
      {loading ? (
        <Skeleton height={180} />
      ) : !book ? (
        <ErrorState title="Book not found" actionLabel="Close" onAction={() => router.back()} />
      ) : (
        <PerCardStyleForm
          name={name}
          priorityText="the series and library-wide"
          currentOverride={book._style as PerCardStyle | undefined}
          seedStyle={seedStyle}
          onSave={(style) => void saveBookStyle(book, style)}
          onClose={() => router.back()}
        />
      )}
    </Screen>
  );
}
