import { useCallback } from "react";
import { router, Stack, useFocusEffect, useLocalSearchParams, useSegments } from "expo-router";
import { bookScreenModel } from "@scripta/shared";
import { BookScreen, bookMenuItems } from "@/features/works/BookScreen";
import { useBook } from "@/features/library/hooks/useBook";
import { useLibrary } from "@/features/library/hooks/useLibrary";
import { ActionSheet, ErrorState, HeaderActions, IconButton, Screen, Skeleton } from "@/ui";
import { useLocale } from "../../../../../i18n";

export default function BookRoute() {
  const locale = useLocale();
  const { key } = useLocalSearchParams<{ key: string }>();
  const { book, loading, workId } = useBook(key);
  const { isError, refetch } = useLibrary();

  const segments = useSegments();

  useFocusEffect(useCallback(() => {
    if (workId) router.replace(`/work/${workId}` as never);
  }, [workId]));

  const model = book ? bookScreenModel(null, book, { isAdmin: false }, locale) : null;
  const menuItems = model && key ? bookMenuItems(model, key, segments) : [];

  return (
    <Screen bottom top={false}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "",
          headerRight: menuItems.length > 0
            ? () => (
                <HeaderActions>
                  <ActionSheet title={typeof book?.title === "string" && book.title ? book.title : "Book"} groups={[menuItems]}>
                    {(open) => <IconButton accessibilityLabel="Book actions" name="more" onPress={open} />}
                  </ActionSheet>
                </HeaderActions>
              )
            : undefined,
        }}
      />
      {loading || workId ? (
        <Skeleton height={180} />
      ) : book && model ? (
        <BookScreen page={null} book={book} model={model} signedIn />
      ) : isError ? (
        <ErrorState body="Couldn't load your library." actionLabel="Retry" onAction={() => void refetch()} />
      ) : (
        <ErrorState title="Book not found" body="It may have been removed from your library." actionLabel="Back" onAction={() => router.back()} />
      )}
    </Screen>
  );
}
