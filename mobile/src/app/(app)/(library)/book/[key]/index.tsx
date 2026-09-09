import { router, useLocalSearchParams } from "expo-router";
import { BookDetail } from "@/features/library/components/BookDetail";
import { useBook } from "@/features/library/hooks/useBook";
import { useLibraryActions } from "@/features/library/hooks/useLibraryActions";
import { ErrorState, Screen, Skeleton } from "@/ui";

export default function BookDetailRoute() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { book, loading } = useBook(key);
  const { cycleStatus } = useLibraryActions();
  const to = (suffix: string) => router.push(`/book/${encodeURIComponent(key ?? "")}/${suffix}` as never);

  return (
    <Screen top={false}>
      {loading ? (
        <Skeleton height={180} />
      ) : !book ? (
        <ErrorState title="Book not found" body="It may have been removed from your library." actionLabel="Close" onAction={() => router.back()} />
      ) : (
        <BookDetail
          book={book}
          onOpenStyle={() => to("style")}
          onOpenCoverPicker={() => to("cover")}
          onSetStatus={cycleStatus}
          onClose={() => router.back()}
        />
      )}
    </Screen>
  );
}
