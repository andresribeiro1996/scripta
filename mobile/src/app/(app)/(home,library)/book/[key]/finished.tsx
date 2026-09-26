import { router, useLocalSearchParams } from "expo-router";
import type { ReadSnapshot } from "@scripta/shared";
import { FinishedScreen } from "@/features/library/FinishedScreen";
import { useBook } from "@/features/library/hooks/useBook";
import { ErrorState, Screen, Skeleton } from "@/ui";

export default function FinishedRoute() {
  const { key, before } = useLocalSearchParams<{ key: string; before?: string }>();
  const { book, loading } = useBook(key);
  const snapshot: ReadSnapshot = before ? JSON.parse(decodeURIComponent(before)) : {};
  return (
    <Screen top={false}>
      {loading ? <Skeleton height={180} /> : !book ? (
        <ErrorState title="Book not found" body="It may have been removed from your library." actionLabel="Close" onAction={() => router.back()} />
      ) : <FinishedScreen book={book} before={snapshot} onClose={() => router.back()} />}
    </Screen>
  );
}
