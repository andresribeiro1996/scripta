// /shared/library/:token — the page a link recipient lands on for a
// shared whole library (see App.tsx: OUTSIDE every RequireAuth/
// RequireUsername wrapper, no session at all). The backend's
// GET /library/shared/:token (backend/src/modules/library/routes.ts) has
// already redacted each book down to a public-safe field subset before
// this ever runs (see backend/src/modules/library/service.ts's
// toPublicLibraryData/toPublicLibraryBook — highlights and other private
// per-book data are dropped server-side) — no further reconstruction is
// needed here: `data.books` is already in the same field NAMES (Title,
// Attribution, ISBN, ImageId, _coverUrl, etc.) BookCard.tsx/
// lib/merge.ts's bookKey() expect, just trimmed down to what this
// read-only view actually renders.
//
// Reuses LibraryPage.tsx's own grid/BookCard rendering pattern (read-only:
// no onOpenStyle/onOpenCoverPicker/selectable passed — see BookCard.tsx's
// own prop handling, confirmed by reading it: with all three omitted, no
// Style/Cover button or selection checkbox renders at all) rather than
// duplicating a second copy of that markup with a "read-only" flag bolted
// on.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { fetchSharedLibrary } from "../api/sharedLibrary";
import { BookCard } from "../components/BookCard";
import { BookGrid } from "../components/BookGrid";
import { LibraryCanvas } from "../components/LibraryCanvas";
import { PageContainer } from "../components/PageContainer";
import { orderLibraryBooks } from "../lib/libraryOrder";
import { bookKey } from "../lib/merge";
import { resolveLibraryStyle } from "../lib/libraryStyle";

function InfoScreen({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-5 text-center">
      <p className="text-(--color-text-dim)">{message}</p>
    </div>
  );
}

export function SharedLibraryPage() {
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["sharedLibrary", token],
    queryFn: () => fetchSharedLibrary(token!),
    enabled: Boolean(token),
    // Same reasoning as SharedMuralPage.tsx: a 404 here (unshared/never-
    // shared token) is expected steady-state, not worth retrying.
    retry: false
  });

  const style = resolveLibraryStyle(data?.data.style);
  const books = data?.data.books ?? [];
  // Same display order (series clustered ahead of standalone books) the
  // authenticated LibraryPage.tsx itself uses — kept via useMemo for the
  // same "don't look 'new' to a memo every render" reason that page's own
  // displayBooks does.
  const displayBooks = useMemo(() => orderLibraryBooks(books, data?.data.groups ?? []), [data]);

  if (!token || isError) {
    return <InfoScreen message="This link is invalid or no longer active." />;
  }
  if (isLoading || !data) {
    return <InfoScreen message="Loading…" />;
  }

  return (
    <PageContainer maxWidth={style.contentMaxWidth}>
      <header className="mb-6">
        <h1 className="text-lg font-bold">{data.data.name || "Library"}</h1>
      </header>
      {books.length === 0 ? (
        <p className="text-sm text-(--color-text-dim)">This library is empty.</p>
      ) : (
        <LibraryCanvas style={style}>
          <BookGrid style={style}>
            {displayBooks.map((book, i) => (
              <BookCard key={String(book.ContentID ?? bookKey(book) ?? i)} book={book} onClick={() => {}} style={style} />
            ))}
          </BookGrid>
        </LibraryCanvas>
      )}
    </PageContainer>
  );
}
