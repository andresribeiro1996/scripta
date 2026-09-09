import { useMemo } from "react";
import { Stack } from "expo-router";
import { bookKey, orderLibraryBooks, resolveLibraryStyle } from "@scripta/shared";
import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";
import { EmptyState, ErrorState, Screen, Skeleton } from "../../ui";
import { spacing, typography, useTheme } from "../../ui/theme";
import { BookCard } from "../library/components/BookCard";
import { LibraryGrid } from "../library/components/LibraryGrid";
import { fetchSharedLibrary } from "./api";

export function SharedLibraryScreen({ token }: { token: string }) {
  const { colors } = useTheme();
  const query = useQuery({ queryKey: ["shared-library", token], queryFn: () => fetchSharedLibrary(token), enabled: Boolean(token), retry: false });
  const style = resolveLibraryStyle(query.data?.data.style);
  const books = query.data?.data.books ?? [];
  const ordered = useMemo(() => orderLibraryBooks(books, query.data?.data.groups ?? []), [books, query.data?.data.groups]);

  if (query.isPending) return <View style={[styles.center, { backgroundColor: colors.background }]}><Skeleton height={180} /></View>;
  if (query.isError || !query.data) return <View style={[styles.center, { backgroundColor: colors.background }]}><ErrorState title="Library unavailable" body="This link is invalid or no longer active." /></View>;
  return <Screen bottom top={false} style={styles.screen}>
    <Stack.Screen options={{ headerShown: true, title: query.data.data.name || "Library" }} />
    <LibraryGrid data={ordered} style={style} keyExtractor={(book, index) => bookKey(book) || String(index)} ListEmptyComponent={<EmptyState title="This library is empty" />} renderItem={(book) => <BookCard book={book} onPress={() => undefined} style={style} />} />
  </Screen>;
}

const styles = StyleSheet.create({
  screen: {},
  center: { flex: 1, justifyContent: "center", padding: spacing.lg },
});
