import { useMemo, useState } from "react";
import type { LibraryData } from "../api/library";
import { orderLibraryBooks } from "../lib/libraryOrder";
import { resolveLibraryStyle } from "../lib/libraryStyle";
import { bookKey } from "../lib/merge";
import { AddBookSheet } from "./AddBookSheet";
import { BookCard } from "./BookCard";
import { BookGrid } from "./BookGrid";
import { LibraryCanvas } from "./LibraryCanvas";

export function PublicLibraryGrid({ library }: { library: LibraryData }) {
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const style = resolveLibraryStyle(library.style);
  const displayBooks = useMemo(() => orderLibraryBooks(library.books, library.groups ?? []), [library]);

  if (library.books.length === 0) return <p className="text-sm text-(--color-text-dim)">This library is empty.</p>;
  return (
    <>
      <LibraryCanvas style={style}>
        <BookGrid style={style}>
          {displayBooks.map((book, i) => (
            <BookCard key={String(book.ContentID ?? bookKey(book) ?? i)} book={book} onClick={() => setSelected(book)} style={style} />
          ))}
        </BookGrid>
      </LibraryCanvas>
      {selected && (
        <AddBookSheet
          book={{
            title: String(selected.Title ?? ""),
            author: String(selected.Attribution ?? ""),
            isbn: selected.ISBN == null ? null : String(selected.ISBN),
            coverUrl: typeof selected._coverUrl === "string" ? selected._coverUrl : null
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}
