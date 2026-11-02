import { useMemo, useState, type ReactNode } from "react";
import { View } from "react-native";
import { bookKey, orderLibraryBooks, resolveLibraryStyle, type LibraryData } from "@scripta/shared";
import { useT } from "../../i18n";
import { EmptyState, spacing } from "../../ui";
import { AddBookSheet } from "../community/AddBookSheet";
import type { ProfileSection } from "../community/ProfileScroller";
import { BookCard } from "../library/components/BookCard";
import { LibraryGrid, useLibraryGridColumns } from "../library/components/LibraryGrid";

type Book = Record<string, unknown>;

function BookSheet({ book, onClose }: { book: Book; onClose: () => void }) {
  return <AddBookSheet book={{ title: String(book.Title ?? ""), author: String(book.Attribution ?? ""), isbn: book.ISBN == null ? null : String(book.ISBN), coverUrl: typeof book._coverUrl === "string" ? book._coverUrl : null }} onClose={onClose} />;
}

export function PublicLibraryGrid({ library, onPressBook, topInset }: { library: LibraryData | null; onPressBook?: (book: Book) => void; topInset?: number }) {
  const t = useT();
  const [selected, setSelected] = useState<Book | null>(null);
  const style = resolveLibraryStyle(library?.style);
  const ordered = useMemo(() => orderLibraryBooks(library?.books ?? [], library?.groups ?? []), [library]);
  return <>
    <LibraryGrid data={ordered} style={style} topInset={topInset} keyExtractor={(book, index) => bookKey(book) || String(index)} ListEmptyComponent={<EmptyState title={t("sharing.libraryEmpty")} />} renderItem={(book) => <BookCard book={book} onPress={() => (onPressBook ? onPressBook(book) : setSelected(book))} style={style} />} />
    {selected ? <BookSheet book={selected} onClose={() => setSelected(null)} /> : null}
  </>;
}

export function useLibrarySection(library: LibraryData | null): { section: ProfileSection<Book[]>; sheet: ReactNode } {
  const t = useT();
  const [selected, setSelected] = useState<Book | null>(null);
  const style = resolveLibraryStyle(library?.style);
  const { columns, contentWidth } = useLibraryGridColumns(style);
  const cellWidth = (contentWidth - style.cardGap * (columns - 1)) / columns;
  const rows = useMemo(() => {
    const ordered = orderLibraryBooks(library?.books ?? [], library?.groups ?? []);
    return Array.from({ length: Math.ceil(ordered.length / columns) }, (_, index) => ordered.slice(index * columns, (index + 1) * columns));
  }, [library, columns]);
  const rowStyle = { flexDirection: "row", gap: style.cardGap, paddingHorizontal: spacing.lg + style.contentPaddingX, paddingBottom: style.rowGap, backgroundColor: style.backgroundColor ?? undefined } as const;
  return {
    section: {
      data: rows,
      keyExtractor: (row, index) => bookKey(row[0]!) || String(index),
      renderItem: (row, index) => (
        <View style={[rowStyle, index === 0 ? { paddingTop: style.contentPaddingY + spacing.lg } : null]}>
          {row.map((book, column) => <View key={bookKey(book) || String(column)} style={{ width: cellWidth }}><BookCard book={book} onPress={() => setSelected(book)} style={style} /></View>)}
        </View>
      ),
      ListEmptyComponent: <EmptyState title={t("sharing.libraryEmpty")} />,
    },
    sheet: selected ? <BookSheet book={selected} onClose={() => setSelected(null)} /> : null,
  };
}
