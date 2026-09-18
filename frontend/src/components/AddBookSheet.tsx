import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { addBookToLibrary } from "../api/library";
import { useAuth } from "../auth/AuthContext";
import { CoverImage } from "./BookCard";
import { Sheet } from "./Sheet";
import { useToast } from "./Toaster";
import { statusLabel } from "../lib/covers";

/** Add-one-book sheet for the public pages (shared library, arena,
 *  tier-list voting): a link recipient sees a book they like, picks a
 *  read status, and it lands in THEIR library via POST /library/books —
 *  a same-shelf upsert, so the toast says "updated" rather than "added"
 *  when they already had it.
 *
 *  Handles signed-out itself (every host page is public, so the sheet
 *  must) rather than making each of the three pages repeat that check:
 *  a sign-in link that carries `from` so the user comes back here. */
export function AddBookSheet({
  book,
  onClose
}: {
  book: { title: string; author: string; isbn?: string | null; coverUrl?: string | null };
  onClose: () => void;
}) {
  const { session } = useAuth();
  const location = useLocation();
  const toast = useToast();
  const [busyStatus, setBusyStatus] = useState<0 | 1 | 2 | null>(null);

  // Memoized for the same reason DuelCard.tsx memoizes its adapted book:
  // CoverImage resets its resolved-cover state on a new object reference,
  // and host pages re-render on their own polls.
  const coverBook = useMemo(
    () => ({ Title: book.title, Attribution: book.author, ISBN: book.isbn ?? undefined, _coverUrl: book.coverUrl ?? undefined }),
    [book.title, book.author, book.isbn, book.coverUrl]
  );

  if (!session) {
    return (
      <Sheet title="Add to your library" onClose={onClose}>
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <p className="text-sm text-(--color-text-dim)">Sign in to add books to your library.</p>
          <Link
            to="/login"
            state={{ from: location }}
            className="min-h-9 rounded-lg bg-(--color-accent) px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Sign in
          </Link>
        </div>
      </Sheet>
    );
  }

  async function handleAdd(readStatus: 0 | 1 | 2) {
    setBusyStatus(readStatus);
    try {
      const { updated } = await addBookToLibrary({
        title: book.title,
        author: book.author,
        isbn: book.isbn ?? null,
        coverUrl: book.coverUrl ?? null,
        readStatus
      });
      toast({ message: updated ? "Updated in your library." : "Added to your library." });
      onClose();
    } catch {
      toast({ message: "Could not add the book.", kind: "error" });
    } finally {
      setBusyStatus(null);
    }
  }

  const actionClass =
    "rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2.5 text-sm font-medium hover:bg-(--color-surface-hover) disabled:opacity-60";

  return (
    <Sheet title="Add to your library" onClose={onClose}>
      <div className="flex gap-3 p-3">
        <div className="relative aspect-[2/3] w-20 shrink-0 overflow-hidden rounded-lg bg-(--color-border)">
          <CoverImage book={coverBook} />
        </div>
        <div className="min-w-0 py-0.5">
          <p className="truncate font-semibold">{book.title}</p>
          <p className="mt-0.5 truncate text-sm text-(--color-text-dim)">{book.author}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 p-3 pt-0">
        {([0, 1, 2] as const).map((status) => (
          <button
            key={status}
            onClick={() => void handleAdd(status)}
            disabled={busyStatus !== null}
            className={`${actionClass} w-full`}
          >
            {busyStatus === status ? "Adding…" : statusLabel(status)}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
