import { useMemo } from "react";
import { bookKey, orderLibraryBooks, resolveLibraryStyle } from "@scripta/shared";
import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";
import { EmptyState, ErrorState, Skeleton } from "../../ui";
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
  return <View style={[styles.screen, { backgroundColor: colors.background }]}>
    <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{query.data.data.name || "Library"}</Text>
    <LibraryGrid data={ordered} style={style} keyExtractor={(book, index) => bookKey(book) || String(index)} ListEmptyComponent={<EmptyState title="This library is empty" />} renderItem={(book) => <BookCard book={book} onPress={() => undefined} style={style} />} />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: spacing.huge },
  center: { flex: 1, justifyContent: "center", padding: spacing.lg },
  title: { ...typography.heading, fontWeight: "700", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
});
