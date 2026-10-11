import { useEffect, useState } from "react";
import { router, Stack, useSegments } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StyleSheet } from "react-native";
import { blendHex, bookKey, bookScreenModel, coverWash } from "@scripta/shared";
import { isPermanentError } from "../../core/apiClient";
import { useAuth } from "../../core/auth";
import { ErrorState, HeaderActions, IconButton, Menu, Screen, Skeleton, Toast, spacing, useTheme } from "../../ui";
import { AddBookSheet } from "../community/AddBookSheet";
import { LIBRARY_QUERY_KEY, useLibrary } from "../library/hooks/useLibrary";
import { ContentShareSheet } from "../sharing/ContentShareSheet";
import { publicContentUrl } from "../sharing/links";
import { fetchWork } from "./api";
import { BookScreen, bookMenuItems } from "./BookScreen";
import { workPath } from "./workPath";

export function WorkScreen({ id }: { id: string }) {
  const [adding, setAdding] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const segments = useSegments();
  const { colors, mode } = useTheme();
  const signedIn = useAuth().user !== null;
  const libraryQuery = useLibrary({ enabled: signedIn });
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["works", id], queryFn: () => fetchWork(id), retry: false });
  const canonicalId = query.data?.work.id;
  const canonicalPath = canonicalId && canonicalId !== id ? workPath(canonicalId, segments) : null;

  useEffect(() => {
    if (canonicalPath) router.replace(canonicalPath as never);
  }, [canonicalPath]);

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
  const menuItems = book && page.mine ? bookMenuItems(model, page.mine.bookKey, segments) : [];
  const wash = coverWash(work.coverColor, mode);
  const headerStyle = wash && work.coverColor ? { backgroundColor: blendHex(colors.background, work.coverColor, wash.topAlpha) } : undefined;
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
          ...(headerStyle ? { headerStyle } : {}),
          headerRight: () => (
            <HeaderActions>
              <IconButton framed name="share" accessibilityLabel="Share book" onPress={() => void share()} />
              {menuItems.length > 0 ? <Menu title={work.title} items={menuItems}><IconButton framed accessibilityLabel="Book actions" name="more" /></Menu> : null}
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
