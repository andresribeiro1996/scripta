import { router, Stack, useLocalSearchParams } from "expo-router";
import { CoverPicker } from "@/features/library/components/CoverPicker";
import { useBook } from "@/features/library/hooks/useBook";
import { useLibraryActions } from "@/features/library/hooks/useLibraryActions";
import { ErrorState, Screen, SheetHeader, Skeleton } from "@/ui";

export default function BookCoverRoute() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { book, loading } = useBook(key);
  const { saveBookCover, removeBookCover } = useLibraryActions();
  const title = String(book?.Title ?? "");
  const sheetTitle = title ? `Cover for "${title}"` : "Cover";

  return (
    <Screen top={false}>
      <Stack.Screen options={{ title: sheetTitle, headerShown: false }} />
      <SheetHeader title={sheetTitle} onClose={() => router.back()} />
      {loading ? (
        <Skeleton height={180} />
      ) : !book ? (
        <ErrorState title="Book not found" actionLabel="Close" onAction={() => router.back()} />
      ) : (
        <CoverPicker
          title={title}
          currentImageId={typeof book._coverImageId === "string" ? book._coverImageId : null}
          onSelect={(image) => void saveBookCover(book, image)}
          onRemoveCover={() => void removeBookCover(book)}
          onClose={() => router.back()}
        />
      )}
    </Screen>
  );
}
