import { router, useLocalSearchParams } from "expo-router";
import type { ReadSnapshot } from "@scripta/shared";
import { FinishedScreen } from "@/features/library/FinishedScreen";
import { useBook } from "@/features/library/hooks/useBook";
import { ErrorState, Screen, Skeleton } from "@/ui";

// Expo Router already URI-decodes route params, so `before` arrives as
// plain JSON text — a second decodeURIComponent (the previous bug) mangled
// any snapshot value containing a literal "%". An absent or unparseable
// value means "no snapshot to undo to", not a crash; anything other than a
// malformed-JSON SyntaxError still propagates.
function parseBefore(raw: string | undefined): ReadSnapshot | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ReadSnapshot;
  } catch (err) {
    if (err instanceof SyntaxError) return null;
    throw err;
  }
}

export default function FinishedRoute() {
  const { key, before } = useLocalSearchParams<{ key: string; before?: string }>();
  const { book, loading } = useBook(key);
  const snapshot = parseBefore(before);
  return (
    <Screen top={false}>
      {loading ? <Skeleton height={180} /> : !book ? (
        <ErrorState title="Book not found" body="It may have been removed from your library." actionLabel="Close" onAction={() => router.back()} />
      ) : <FinishedScreen book={book} before={snapshot} onClose={() => router.back()} />}
    </Screen>
  );
}
