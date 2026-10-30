import { useEffect, useRef, useState } from "react";
import { router, Stack, useSegments } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StyleSheet, View } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { useHeaderHeight } from "expo-router/react-navigation";
import { bookKey, bookScreenModel, coverWash, localDay, saveFailureMessage } from "@scripta/shared";
import { isPermanentError } from "../../core/apiClient";
import { useAuth } from "../../core/auth";
import { useScreenOptions } from "../../ui/navigation";
import { ActionSheet, Button, ErrorState, HeaderActions, IconButton, Screen, Skeleton, Toast, spacing, useTheme } from "../../ui";
import { useToast } from "../../ui/ToastHost";
import { AddBookSheet } from "../community/AddBookSheet";
import { addBookToLibrary } from "../library/api/client";
import { LIBRARY_QUERY_KEY, useLibrary } from "../library/hooks/useLibrary";
import { toRecommendation } from "../library/lib/recommendation";
import { ContentShareSheet } from "../sharing/ContentShareSheet";
import { publicContentUrl } from "../sharing/links";
import { fetchWork } from "./api";
import { BookScreen, WashBackdrop, bookMenuItems } from "./BookScreen";
import { workPath } from "./workPath";

export function WorkScreen({ id, edition = null }: { id: string; edition?: string | null }) {
  const [adding, setAdding] = useState(false);
  const [addingToRead, setAddingToRead] = useState(false);
  const addInFlight = useRef(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [editionId, setEditionId] = useState<string | null>(edition);
  const scrollY = useSharedValue(0);
  const headerHeight = useHeaderHeight();
  const segments = useSegments();
  const { mode, colors } = useTheme();
  const { show } = useToast();
  const screenOptions = useScreenOptions();
  const signedIn = useAuth().user !== null;
  const libraryQuery = useLibrary({ enabled: signedIn });
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["works", id], queryFn: () => fetchWork(id), retry: false });
  const canonicalId = query.data?.work.id;
  const canonicalPath = canonicalId && canonicalId !== id ? workPath(canonicalId, segments, edition) : null;

  useEffect(() => {
    if (canonicalPath) router.replace(canonicalPath as never);
  }, [canonicalPath]);

  const plainHeader = {
    headerTransparent: false,
    headerStyle: screenOptions.headerStyle,
    headerLargeTitleEnabled: screenOptions.headerLargeTitleEnabled,
    headerShadowVisible: screenOptions.headerShadowVisible,
  };
  const untitled = <Stack.Screen options={{ headerShown: true, title: "", ...plainHeader }} />;
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
  const model = bookScreenModel(page, book, { isAdmin: false }, editionId);
  const menuItems = book && page.mine ? bookMenuItems(model, page.mine.bookKey, segments) : [];
  const wash = coverWash(model.cover.color, mode);
  const tint = wash && model.cover.color ? { color: model.cover.color, topAlpha: wash.topAlpha } : null;

  async function share() {
    setShareError(null);
    try {
      setShareUrl(await publicContentUrl(`/work/${encodeURIComponent(work.id)}`));
    } catch (reason) {
      setShareError(reason instanceof Error ? reason.message : "Couldn't create the share link.");
    }
  }

  async function wantToRead() {
    if (!signedIn) {
      setAdding(true);
      return;
    }
    if (addInFlight.current || !model.addBook) return;
    addInFlight.current = true;
    setAddingToRead(true);
    let added = false;
    try {
      await addBookToLibrary({ ...toRecommendation(model.addBook, 0), day: localDay() });
      added = true;
      await queryClient.refetchQueries({ queryKey: LIBRARY_QUERY_KEY }, { throwOnError: true });
      await query.refetch({ throwOnError: true });
    } catch (error) {
      show(added ? "Added to your library, but the page didn't refresh." : saveFailureMessage(error, "Could not add the book."), "error");
    } finally {
      addInFlight.current = false;
      setAddingToRead(false);
    }
  }

  return (
    <Screen bottom top={false}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: work.title,
          ...(tint ? { headerTransparent: true, headerStyle: { backgroundColor: "transparent" }, headerLargeTitleEnabled: false, headerShadowVisible: false } : plainHeader),
          headerRight: () => (
            <HeaderActions>
              <IconButton name="share" accessibilityLabel="Share book" onPress={() => void share()} />
              {menuItems.length > 0 ? <ActionSheet title={work.title} groups={[menuItems]}>{(open) => <IconButton accessibilityLabel="Book actions" name="more" onPress={open} />}</ActionSheet> : null}
            </HeaderActions>
          ),
        }}
      />
      {shareError && !tint ? <Toast visible message={shareError} tone="error" /> : null}
      {tint ? <WashBackdrop color={tint.color} topAlpha={tint.topAlpha} scrollY={scrollY} headerHeight={headerHeight} /> : null}
      <BookScreen page={page} book={book} model={model} signedIn={signedIn} onSelectEdition={setEditionId} scrollY={scrollY} headerInset={tint ? headerHeight : 0} />
      {model.primary === "add" ? (
        <View style={[styles.wantBar, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
          <Button label="Want to read" variant="primary" loading={addingToRead} onPress={() => void wantToRead()} />
        </View>
      ) : null}
      {shareError && tint ? <View pointerEvents="box-none" style={[styles.toastBelowHeader, { top: headerHeight }]}><Toast visible message={shareError} tone="error" /></View> : null}
      <ContentShareSheet visible={shareUrl !== null} onClose={() => setShareUrl(null)} title={work.title} url={shareUrl} />
      {adding && !signedIn && model.addBook ? <AddBookSheet book={model.addBook} onClose={() => setAdding(false)} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  toastBelowHeader: { position: "absolute", left: 0, right: 0 },
  wantBar: { padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  centered: { padding: spacing.lg, gap: spacing.md },
});
