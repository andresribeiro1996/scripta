import { useMemo, useState } from "react";
import { bookKey, orderLibraryBooks, resolveLibraryStyle, type LibraryData } from "@scripta/shared";
import { EmptyState } from "../../ui";
import { AddBookSheet } from "../community/AddBookSheet";
import { BookCard } from "../library/components/BookCard";
import { LibraryGrid } from "../library/components/LibraryGrid";

export function PublicLibraryGrid({ library, onPressBook }: { library: LibraryData | null; onPressBook?: (book: Record<string, unknown>) => void }) {
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const style = resolveLibraryStyle(library?.style);
  const ordered = useMemo(() => orderLibraryBooks(library?.books ?? [], library?.groups ?? []), [library]);
  return <>
    <LibraryGrid data={ordered} style={style} keyExtractor={(book, index) => bookKey(book) || String(index)} ListEmptyComponent={<EmptyState title="This library is empty" />} renderItem={(book) => <BookCard book={book} onPress={() => (onPressBook ? onPressBook(book) : setSelected(book))} style={style} />} />
    {selected ? <AddBookSheet book={{ title: String(selected.Title ?? ""), author: String(selected.Attribution ?? ""), isbn: selected.ISBN == null ? null : String(selected.ISBN), coverUrl: typeof selected._coverUrl === "string" ? selected._coverUrl : null }} onClose={() => setSelected(null)} /> : null}
  </>;
}
