import { useMemo, type ReactElement } from "react";
import { FlatList, type FlatListProps, StyleSheet, useWindowDimensions, View } from "react-native";
import type { LibraryStyleSettings } from "@scripta/shared";
import { spacing, useTheme } from "../../../ui/theme";
import { libraryGridColumns } from "../lib/gridColumns";

const SCREEN_PADDING = spacing.lg;

export function useLibraryGridColumns(style: LibraryStyleSettings): { columns: number; contentWidth: number } {
  const { width } = useWindowDimensions();
  return useMemo(() => {
    const contentWidth = Math.max(0, width - SCREEN_PADDING * 2 - style.contentPaddingX * 2);
    const columns = libraryGridColumns(width, contentWidth, style);
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
  ListFooterComponent,
  refreshControl,
  topInset = 0,
}: {
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (item: T, index: number, cellWidth: number) => ReactElement;
  style: LibraryStyleSettings;
  ListEmptyComponent?: FlatListProps<T>["ListEmptyComponent"];
  ListHeaderComponent?: FlatListProps<T>["ListHeaderComponent"];
  ListFooterComponent?: FlatListProps<T>["ListFooterComponent"];
  refreshControl?: FlatListProps<T>["refreshControl"];
  topInset?: number;
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
      ListFooterComponent={ListFooterComponent}
      columnWrapperStyle={{ gap: style.cardGap }}
      // A search field can sit in this grid's header: without this the
      // first tap on a card only dismisses the keyboard.
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={[
        styles.content,
        {
          backgroundColor: style.backgroundColor ?? undefined,
          paddingHorizontal: SCREEN_PADDING + style.contentPaddingX,
          paddingTop: style.contentPaddingY + topInset,
          paddingBottom: style.contentPaddingY + spacing.xxxl,
          gap: style.rowGap,
        },
      ]}
      // Windowing tuned for cover-art cells (heavier than plain text
      // rows) rather than FlatList's text-list-oriented defaults — see
      // this task's brief: never render the full collection.
      windowSize={7}
      maxToRenderPerBatch={12}
      initialNumToRender={columns * 4}
      removeClippedSubviews
      renderItem={({ item, index }) => <View style={{ width: cellWidth }}>{renderItem(item, index, cellWidth)}</View>}
      style={{ backgroundColor: colors.background }}
    />
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
});
