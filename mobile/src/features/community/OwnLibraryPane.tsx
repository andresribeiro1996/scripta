import { useMemo, useState } from "react";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "../../ui/Text";
import {
  bookKey,
  effectiveCardStyle,
  filterBooks,
  orderLibraryBooks,
  resolveLibraryStyle,
  seriesGroupByBookKey,
  STATUS_FILTER_OPTIONS,
  type PerCardStyle,
  type StatusFilter,
} from "@scripta/shared";
import { dynamicType, EmptyState, ErrorState, Fab, Input, radii, Skeleton, spacing, typography, useTheme } from "../../ui";
import { BookCard } from "../library/components/BookCard";
import { LibraryGrid } from "../library/components/LibraryGrid";
import { useLibrary } from "../library/hooks/useLibrary";

export function OwnLibraryPane() {
  const { colors } = useTheme();
  const { data: library, isPending, isError, refetch } = useLibrary();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const books = useMemo(() => orderLibraryBooks(library?.data.books ?? [], library?.data.groups ?? []), [library]);
  const style = resolveLibraryStyle(library?.data.style);
  const bookSeriesGroup = useMemo(() => seriesGroupByBookKey(library?.data.books ?? [], library?.data.groups ?? []), [library]);
  const filtered = filterBooks(books, query, status);

  if (isPending) return <View style={styles.center}><Skeleton height={180} /></View>;
  if (isError) return <ErrorState body="Couldn't load your library." actionLabel="Retry" onAction={() => refetch()} />;

  return (
    <View style={styles.fill}>
      <LibraryGrid
        data={filtered}
        keyExtractor={(book, i) => String(book.ContentID ?? i)}
        style={style}
        ListHeaderComponent={
          <View style={styles.header}>
            <Input
              icon="search"
              accessibilityLabel="Search your books"
              placeholder="Search books"
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              returnKeyType="search"
              value={query}
              onChangeText={setQuery}
            />
            <View style={styles.chipsRow}>
              {STATUS_FILTER_OPTIONS.map((option) => {
                const selected = option.value === status;
                const count = filterBooks(books, "", option.value).length;
                const label = option.value === "all" ? "All" : option.label;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setStatus(option.value)}
                    style={[styles.chip, { borderColor: colors.border, backgroundColor: selected ? colors.accentSoft : colors.surface }]}
                  >
                    <Text {...dynamicType} numberOfLines={1} style={[typography.caption, styles.strong, { color: selected ? colors.accent : colors.text }]}>
                      {label} {count}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        }
        ListEmptyComponent={
          books.length === 0 ? (
            <EmptyState
              title="Start your library"
              body="Import a library.json, KoboReader.sqlite, Goodreads CSV, or StoryGraph CSV — or add a book by hand."
              actionLabel="Import library…"
              onAction={() => router.push("/import" as never)}
            />
          ) : (
            <EmptyState title="No books match" />
          )
        }
        ListFooterComponent={<View style={styles.fabClearance} />}
        renderItem={(book) => {
          const seriesGroup = bookSeriesGroup.get(bookKey(book));
          const cardStyle = effectiveCardStyle(style, seriesGroup?.style, book._style as PerCardStyle | undefined);
          return (
            <BookCard
              book={book}
              onPress={() => router.push(`/book/${encodeURIComponent(bookKey(book))}` as never)}
              style={cardStyle}
            />
          );
        }}
      />
      <Fab label="New" accessibilityLabel="Add a book" onPress={() => router.push("/add-book" as never)} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, padding: spacing.lg },
  fill: { flex: 1 },
  fabClearance: { height: 96 },
  strong: { fontWeight: "700" },
  header: { gap: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.sm },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { height: 32, paddingHorizontal: spacing.md, borderRadius: radii.full, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
