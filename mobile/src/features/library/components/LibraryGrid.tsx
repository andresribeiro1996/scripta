// The native equivalent of frontend's LibraryCanvas.tsx + BookGrid.tsx —
// a virtualized grid (FlatList, per this task's brief: never render the
// full collection at once) instead of a CSS `repeat(auto-fill, minmax(...))`
// grid. Column count is a native approximation of that CSS rule (floor of
// available-width / cardMinWidth, at least 2 so a phone never renders a
// single full-bleed column), NOT a port of frontend's index.css phone-
// breakpoint scaling (PHONE_COLUMNS_AT_DEFAULT_SIZE) — that scaling only
// ever existed as CSS, never as shared portable logic (see this task's
// handoff notes for the exact gap).
//
// `numColumns` cannot change without remounting a FlatList (a hard RN
// limitation), so it's part of `key` below — a rotation or a style change
// that shifts the column count gets a fresh list instead of a
// half-relaid-out one.

import { useMemo, type ReactElement } from "react";
import { FlatList, type FlatListProps, StyleSheet, useWindowDimensions, View } from "react-native";
import type { LibraryStyleSettings } from "@scripta/shared";
import { spacing, useTheme } from "../../../ui/theme";

const SCREEN_PADDING = spacing.lg;

export function useLibraryGridColumns(style: LibraryStyleSettings): { columns: number; contentWidth: number } {
  const { width } = useWindowDimensions();
  return useMemo(() => {
    const contentWidth = Math.max(0, width - SCREEN_PADDING * 2 - style.contentPaddingX * 2);
    const gap = style.cardGap;
    const columns = Math.max(2, Math.floor((contentWidth + gap) / (style.cardMinWidth + gap)));
    return { columns, contentWidth };
  }, [width, style.cardMinWidth, style.cardGap, style.contentPaddingX]);
}

export function LibraryGrid<T>({
  data,
  keyExtractor,
  renderItem,
  style,
  ListEmptyComponent,
  ListHeaderComponent,
  refreshControl,
}: {
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (item: T, index: number, cellWidth: number) => ReactElement;
  style: LibraryStyleSettings;
  ListEmptyComponent?: FlatListProps<T>["ListEmptyComponent"];
  ListHeaderComponent?: FlatListProps<T>["ListHeaderComponent"];
  refreshControl?: FlatListProps<T>["refreshControl"];
}) {
  const { colors } = useTheme();
  const { columns, contentWidth } = useLibraryGridColumns(style);
  const cellWidth = (contentWidth - style.cardGap * (columns - 1)) / columns;

  return (
    <FlatList
      key={columns}
      data={data}
      keyExtractor={keyExtractor}
      numColumns={columns}
      refreshControl={refreshControl}
      ListEmptyComponent={ListEmptyComponent}
      ListHeaderComponent={ListHeaderComponent}
      columnWrapperStyle={{ gap: style.cardGap }}
      // The toolbar's search field sits directly above this grid: without
      // this the first tap on a card only dismisses the keyboard.
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={[
        styles.content,
        {
          backgroundColor: style.backgroundColor ?? undefined,
          paddingHorizontal: SCREEN_PADDING + style.contentPaddingX,
          paddingTop: style.contentPaddingY,
          paddingBottom: style.contentPaddingY + spacing.xxxl,
          gap: style.rowGap,
        },
      ]}
      // Windowing tuned for cover-art cells (heavier than plain text
      // rows) rather than FlatList's text-list-oriented defaults — see
      // this task's brief: never render the full collection.
      windowSize={7}
      maxToRenderPerBatch={12}
      initialNumToRender={12}
      removeClippedSubviews
      renderItem={({ item, index }) => <View style={{ width: cellWidth }}>{renderItem(item, index, cellWidth)}</View>}
      style={{ backgroundColor: colors.background }}
    />
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
});
