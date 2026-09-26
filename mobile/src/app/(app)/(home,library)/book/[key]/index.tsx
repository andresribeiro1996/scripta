import { router, useLocalSearchParams } from "expo-router";
import { readSnapshot } from "@scripta/shared";
import { BookDetail } from "@/features/library/components/BookDetail";
import { useBook } from "@/features/library/hooks/useBook";
import { useLibraryActions } from "@/features/library/hooks/useLibraryActions";
import { ErrorState, Screen, Skeleton } from "@/ui";

export default function BookDetailRoute() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const { book, loading } = useBook(key);
  const { setStatus, setRating, deleteNote } = useLibraryActions();
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
          onSetStatus={async (current, status) => {
            const before = readSnapshot(current);
            const wasFinished = current.ReadStatus === 2;
            const saved = await setStatus(current, status);
            if (saved && status === 2 && !wasFinished) to(`finished?before=${encodeURIComponent(JSON.stringify(before))}`);
          }}
          onSetRating={(b, rating) => void setRating(b, rating)}
          onDeleteNote={(b, bookmarkId) => void deleteNote(b, bookmarkId)}
          onClose={() => router.back()}
        />
      )}
    </Screen>
  );
}
