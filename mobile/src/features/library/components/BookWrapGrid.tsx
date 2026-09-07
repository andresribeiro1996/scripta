// A plain, non-virtualized wrapped grid — used for a single group's
// member books (GroupsView.tsx) and the style preview
// (LibraryStyleView.tsx), where the list in question is a small slice of
// the library rather than the whole thing. The top-level Browse view
// (LibraryScreen.tsx) uses LibraryGrid's FlatList instead, per this
// task's brief ("never render the full collection at once") — that
// requirement is about the library as a whole, not every book list this
// feature ever renders; a single series/collection's members are already
// a bounded subset the user picked.

import type { ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import type { LibraryStyleSettings } from "@scripta/shared";
import { useLibraryGridColumns } from "./LibraryGrid";

export function BookWrapGrid({
  books,
  style,
  renderBook,
}: {
  books: Array<Record<string, unknown>>;
  style: LibraryStyleSettings;
  renderBook: (book: Record<string, unknown>, index: number) => ReactElement;
}) {
  const { columns, contentWidth } = useLibraryGridColumns(style);
  const cellWidth = (contentWidth - style.cardGap * (columns - 1)) / columns;

  return (
    <View style={[styles.grid, { gap: style.cardGap, rowGap: style.rowGap }]}>
      {books.map((book, i) => (
        <View key={String(book.ContentID ?? i)} style={{ width: cellWidth }}>
          {renderBook(book, i)}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap" },
});
