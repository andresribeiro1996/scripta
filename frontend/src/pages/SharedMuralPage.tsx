// /shared/murals/:token — the page a link recipient actually lands on
// (see App.tsx: OUTSIDE every RequireAuth/RequireUsername wrapper, no
// session involved at all). Fetches the mural owner's public, redacted
// snapshot (api/sharedMurals.ts, GET /murals/shared/:token) and renders it
// through the SAME MuralCanvas/BlockRenderer the authenticated editor uses
// (components/murals/MuralCanvas.tsx) with editMode={false} — a live view
// of whatever the owner's mural currently holds, not a static snapshot (no
// caching either side: the backend route sends Cache-Control: no-store,
// and this page's own useQuery just refetches on remount/reload).
//
// The one real trick here: MuralCanvas and lib/murals.ts's pure resolvers
// (resolveShelfBooks/resolveQuote/etc.) only know how to read PRIVATE-shaped
// book objects (Title/Attribution/ISBN/ImageId/_coverUrl/ReadStatus/
// highlights — see lib/merge.ts's bookKey()), because that's the only shape
// the authenticated editor ever hands them. The public API instead returns
// already-redacted PublicBookData (title/author/isbn/imageId/coverUrl/
// readStatus — backend/src/modules/library/publicResolver.ts). toPrivateBook
// below reconstructs the private shape from those exact fields so every
// existing resolver keeps working completely unchanged — get this field
// mapping wrong and a block would silently fail to resolve its book instead
// of throwing, so it's worth getting exactly right.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { fetchSharedMural, type PublicBookData, type PublicHighlight } from "../api/sharedMurals";
import type { GalleryImage } from "../api/gallery";
import { MuralCanvas } from "../components/murals/MuralCanvas";
import { bookKey } from "../lib/merge";
import type { Mural } from "../lib/murals";

/** The exact inverse of publicResolver.ts's toPublicBookData — see this
 *  file's own top comment. `highlights` starts empty; the caller
 *  (buildReconstructedBooks below) fills it in afterward once every
 *  book's own bookKey() is known, since a PublicHighlight only carries the
 *  bookKey it belongs to, not a nested position inside PublicBookData. */
function toPrivateBook(pub: PublicBookData): Record<string, unknown> {
  return {
    Title: pub.title,
    Attribution: pub.author,
    ISBN: pub.isbn,
    ImageId: pub.imageId,
    _coverUrl: pub.coverUrl,
    ReadStatus: pub.readStatus,
    highlights: [] as Array<Record<string, unknown>>
  };
}

/** `books` and `currentlyReading` can overlap (a book that's both
 *  spotlighted/shelved AND currently in progress) — deduped by bookKey()
 *  so CurrentlyReadingBlockView (which just filters this same list for
 *  ReadStatus === 1) never shows the same book twice. Every matching
 *  highlight is attached by its own bookKey field (see
 *  api/sharedMurals.ts's PublicHighlight — the backend already computed
 *  this against the SAME bookKey() algorithm, see that route's own
 *  comment), mapped to {BookmarkID, Text, Annotation} so resolveQuote's
 *  `String(h.BookmarkID) === highlightId` match keeps working unchanged. */
function buildReconstructedBooks(books: PublicBookData[], currentlyReading: PublicBookData[], highlights: PublicHighlight[]): Array<Record<string, unknown>> {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const pub of [...books, ...currentlyReading]) {
    const book = toPrivateBook(pub);
    const key = bookKey(book);
    if (!byKey.has(key)) byKey.set(key, book);
  }
  for (const h of highlights) {
    const book = byKey.get(h.bookKey);
    if (!book) continue; // stale/unresolvable reference — same tolerant convention lib/murals.ts's own resolvers use
    (book.highlights as Array<Record<string, unknown>>).push({ BookmarkID: h.highlightId, Text: h.text, Annotation: h.annotation });
  }
  return [...byKey.values()];
}

function InfoScreen({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-5 text-center">
      <p className="text-(--color-text-dim)">{message}</p>
    </div>
  );
}

export function SharedMuralPage() {
  const { token } = useParams<{ token: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["sharedMural", token],
    queryFn: () => fetchSharedMural(token!),
    enabled: Boolean(token),
    // A 404 (unshared/never-shared token) is expected steady-state here,
    // not a transient failure worth retrying — retrying would just delay
    // the "no longer active" message for no benefit.
    retry: false
  });

  const books = useMemo(() => (data ? buildReconstructedBooks(data.books, data.currentlyReading, data.highlights) : []), [data]);

  const images = useMemo<GalleryImage[]>(() => {
    if (!data) return [];
    return Object.entries(data.imageUrls)
      .filter((entry): entry is [string, string] => entry[1] !== null)
      .map(([id, url]) => ({ id, url, filename: "", mimeType: "", width: 0, height: 0, byteSize: 0, createdAt: "" }));
  }, [data]);

  if (!token || isError) {
    return <InfoScreen message="This link is invalid or no longer active." />;
  }
  if (isLoading || !data) {
    return <InfoScreen message="Loading…" />;
  }

  // A minimal, view-only stand-in for the private Mural shape MuralCanvas
  // expects — every field it doesn't itself read (createdAt/updatedAt/
  // shareToken/shareUrl) is filled with an inert placeholder; MuralCanvas
  // only ever reads `mural.blocks` off this object.
  const mural: Mural = {
    id: data.mural.id,
    name: data.mural.name,
    blocks: data.mural.blocks,
    createdAt: "",
    updatedAt: "",
    coverImageUrl: data.mural.coverImageUrl ?? undefined,
    shareToken: null,
    shareUrl: null,
    folderId: null
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <header className="mb-6">
        <h1 className="text-lg font-bold">{mural.name}</h1>
      </header>
      {mural.blocks.length === 0 ? (
        <p className="text-sm text-(--color-text-dim)">This mural is empty.</p>
      ) : (
        <MuralCanvas mural={mural} editMode={false} books={books} images={images} statsOverride={data.stats} />
      )}
    </div>
  );
}
