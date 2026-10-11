import { useEffect, useState } from "react";
import { router, Stack, useSegments } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StyleSheet } from "react-native";
import { bookKey, bookScreenModel } from "@scripta/shared";
import { isPermanentError } from "../../core/apiClient";
import { ErrorState, HeaderActions, IconButton, Screen, Skeleton, Toast, spacing } from "../../ui";
import { AddBookSheet } from "../community/AddBookSheet";
import { LIBRARY_QUERY_KEY, useLibrary } from "../library/hooks/useLibrary";
import { ContentShareSheet } from "../sharing/ContentShareSheet";
import { publicContentUrl } from "../sharing/links";
import { fetchWork } from "./api";
import { BookScreen } from "./BookScreen";

export function WorkScreen({ id }: { id: string }) {
  const [adding, setAdding] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const signedIn = useSegments()[0] === "(app)";
  const libraryQuery = useLibrary({ enabled: signedIn });
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["works", id], queryFn: () => fetchWork(id), retry: false });
  const canonicalId = query.data?.work.id;

  useEffect(() => {
    if (canonicalId && canonicalId !== id) router.replace(`/work/${canonicalId}` as never);
  }, [canonicalId, id]);

  const untitled = <Stack.Screen options={{ headerShown: true, title: "" }} />;
  if (!query.data && query.isError) {
    const permanent = isPermanentError(query.error);
    return (
      <Screen bottom top={false} style={styles.centered}>
        {untitled}
        <ErrorState
          title="Book unavailable"
          body={query.error instanceof Error ? query.error.message : "Couldn't load this book."}
          actionLabel={permanent ? "Back" : "Retry"}
          onAction={permanent ? () => (router.canGoBack() ? router.back() : router.replace("/")) : () => void query.refetch()}
        />
      </Screen>
    );
  }
  if (!query.data || query.data.work.id !== id) return <Screen bottom top={false} style={styles.centered}>{untitled}<Skeleton height={160} /></Screen>;

  const page = query.data;
  const { work } = page;
  const book = page.mine ? libraryQuery.data?.data.books.find((b) => bookKey(b) === page.mine!.bookKey) ?? null : null;
  if (page.mine && !book && libraryQuery.isFetching) return <Screen bottom top={false} style={styles.centered}>{untitled}<Skeleton height={160} /></Screen>;
  if (page.mine && !book && libraryQuery.isError) {
    return (
      <Screen bottom top={false} style={styles.centered}>
        {untitled}
        <ErrorState
          title="Library unavailable"
          body={libraryQuery.error instanceof Error ? libraryQuery.error.message : "Couldn't load your library."}
          actionLabel="Retry"
          onAction={() => void libraryQuery.refetch()}
        />
      </Screen>
    );
  }
  const model = bookScreenModel(page, book, { isAdmin: false });
  const firstEdition = work.editions.find((edition) => edition.isbn) ?? work.editions[0];

  async function share() {
    setShareError(null);
    try {
      setShareUrl(await publicContentUrl(`/work/${encodeURIComponent(work.id)}`));
    } catch (reason) {
      setShareError(reason instanceof Error ? reason.message : "Couldn't create the share link.");
    }
  }

  return (
    <Screen bottom top={false}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: work.title,
          headerRight: () => (
            <HeaderActions>
              <IconButton framed name="share" accessibilityLabel="Share book" onPress={() => void share()} />
            </HeaderActions>
          ),
        }}
      />
      {shareError ? <Toast visible message={shareError} tone="error" /> : null}
      <BookScreen page={page} book={book} model={model} signedIn={signedIn} onAdd={() => setAdding(true)} />
      <ContentShareSheet visible={shareUrl !== null} onClose={() => setShareUrl(null)} title={work.title} url={shareUrl} />
      {adding ? (
        <AddBookSheet
          book={{ title: work.title, author: work.author, isbn: firstEdition?.isbn ?? null, coverUrl: work.coverUrl }}
          onClose={() => {
            setAdding(false);
            void query.refetch();
            void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEY });
          }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { padding: spacing.lg, gap: spacing.md },
});
