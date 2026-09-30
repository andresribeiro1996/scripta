import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bookKey,
  createShelfSession,
  favouriteOpponent,
  formatFinishDay,
  localDay,
  type FinishRating,
  type Landing,
  type Mural,
  type MuralBlock,
  type ReadSnapshot,
  type ShelfSession
} from "@scripta/shared";
import { fetchOwnProfile } from "../api/community";
import { fetchMural, updateMuralApi } from "../api/murals";
import { CoverImage } from "./BookCard";
import { DuelButton } from "./DuelButton";
import { FeelingChips } from "./FeelingChips";
import { Sheet } from "./Sheet";
import { useToast } from "./Toaster";

type Shelf = { blocks: MuralBlock[]; landed: Landing[] };

const secondaryButtonClass =
  "min-h-11 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm font-semibold hover:bg-(--color-surface-hover)";

export function FinishSheet({
  book,
  books,
  before,
  onSetRating,
  onAddNote,
  onRestoreRead,
  onClose
}: {
  book: Record<string, unknown>;
  books: Array<Record<string, unknown>>;
  before: ReadSnapshot | null;
  onSetRating: (book: Record<string, unknown>, rating: FinishRating) => Promise<boolean>;
  onAddNote: (book: Record<string, unknown>, text: string) => Promise<boolean>;
  onRestoreRead: (book: Record<string, unknown>, before: ReadSnapshot) => Promise<boolean>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const own = useQuery({ queryKey: ["community", "own-profile"], queryFn: fetchOwnProfile });
  const toast = useToast();

  const key = bookKey(book);
  const [savedRating, setSavedRating] = useState(false);
  const [note, setNote] = useState("");
  const noteRef = useRef("");
  const settled = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const sessionRef = useRef<ShelfSession | null>(null);
  const startedShelfUpdate = useRef(false);
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [shelfError, setShelfError] = useState<string | null>(null);
  const [favouriteChoiceMade, setFavouriteChoiceMade] = useState(false);

  // While the sheet is still open the in-sheet banner is enough; a save that
  // fails after Done/Undo already closed it (a queued finish/promote settling
  // late) has no banner left to show it, so that case also gets a toast.
  function reportShelfError() {
    if (mounted.current) setShelfError("Couldn't update your shelf.");
    else toast({ message: "Couldn't update your shelf.", kind: "error" });
  }

  useEffect(() => {
    const muralId = own.data?.muralId;
    if (!muralId || startedShelfUpdate.current) return;
    startedShelfUpdate.current = true;
    const session = createShelfSession({
      load: async () => {
        const mural = await fetchMural(muralId);
        return { id: mural.id, blocks: mural.blocks, updatedAt: mural.updatedAt };
      },
      save: async (id, blocks, updatedAt) => {
        const updated = await updateMuralApi(id, { blocks, updatedAt });
        queryClient.setQueryData<Mural[]>(["murals"], (list) => list?.map((m) => (m.id === id ? updated : m)));
        return updated;
      },
      onChange: (state) => { if (mounted.current) setShelf(state); }
    });
    sessionRef.current = session;
    void session.finish(key, typeof book.Rating === "number" ? book.Rating : null).catch(reportShelfError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own.data?.muralId]);

  useEffect(() => () => sessionRef.current?.stop(), []);

  function finish() {
    const text = noteRef.current.trim();
    if (settled.current || !text) return;
    settled.current = true;
    void onAddNote(book, text);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => finish(), []);

  function close() {
    finish();
    onClose();
  }

  async function handleRatingChange(rating: FinishRating) {
    setSavedRating(false);
    const ok = await onSetRating(book, rating);
    if (ok) {
      setSavedRating(true);
      sessionRef.current?.finish(key, rating).catch(reportShelfError);
    }
  }

  async function chooseThisOne() {
    setFavouriteChoiceMade(true);
    try {
      await sessionRef.current?.promote(key);
    } catch {
      reportShelfError();
    }
  }

  async function undo(snapshot: ReadSnapshot) {
    settled.current = true;
    const ok = await onRestoreRead(book, snapshot);
    if (!ok) {
      settled.current = false;
      return;
    }
    const shelfOk = (await sessionRef.current?.restore()) ?? true;
    if (!shelfOk) {
      setShelfError("Couldn't update your shelf.");
      return;
    }
    onClose();
  }

  const opponentKey = shelf ? favouriteOpponent(shelf.blocks, key) : null;
  const opponentBook = opponentKey ? (books.find((candidate) => bookKey(candidate) === opponentKey) ?? null) : null;

  const day = formatFinishDay(typeof book.DateLastRead === "string" ? book.DateLastRead : localDay());
  const landed = shelf?.landed ?? [];
  const footer =
    landed.length === 0
      ? null
      : landed.includes("favourites")
        ? "Added to Finished on your shelf, and to Favourites"
        : "Added to Finished on your shelf";

  return (
    <div className="relative z-[60]">
      <Sheet title="Finished" onClose={close}>
        <div className="flex flex-col gap-5 p-3">
          {shelfError && <p className="rounded-lg bg-(--color-danger-soft) px-3 py-2 text-sm text-(--color-danger)">{shelfError}</p>}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold tracking-wide text-(--color-text-dim) uppercase">{`Finished · ${day}`}</p>
            <button
              type="button"
              onClick={close}
              className="min-h-9 rounded-lg bg-(--color-accent) px-3 py-1.5 text-sm font-semibold text-(--color-on-accent) hover:opacity-90"
            >
              Done
            </button>
          </div>

          <div className="flex gap-4">
            <div className="aspect-[2/3] w-24 shrink-0 overflow-hidden rounded-lg bg-(--color-border)">
              <CoverImage book={book} />
            </div>
            <div className="min-w-0 flex flex-col justify-center">
              <p className="font-bold">{String(book.Title ?? "Untitled")}</p>
              <p className="mt-1 text-(--color-text-dim)">{String(book.Attribution ?? "Unknown author")}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold">How did it land?</p>
            <FeelingChips
              value={typeof book.Rating === "number" ? book.Rating : null}
              onChange={(rating) => void handleRatingChange(rating)}
            />
            {savedRating && <p className="text-xs text-(--color-text-dim)">Saved as your rating</p>}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold">A thought to keep.</p>
            <textarea
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                noteRef.current = e.target.value;
              }}
              placeholder="What stuck with you?"
              rows={4}
              aria-label="A thought to keep"
              className="w-full resize-none rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
            />
          </div>

          {opponentBook && !favouriteChoiceMade && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold">Against your favourite.</p>
              <div className="flex gap-4">
                <div className="flex flex-1 flex-col gap-2">
                  <div className="aspect-[2/3] w-full overflow-hidden rounded-lg bg-(--color-border)">
                    <CoverImage book={book} />
                  </div>
                  <DuelButton onClick={() => void chooseThisOne()}>This one</DuelButton>
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  <div className="aspect-[2/3] w-full overflow-hidden rounded-lg bg-(--color-border)">
                    <CoverImage book={opponentBook} />
                  </div>
                  <DuelButton onClick={() => setFavouriteChoiceMade(true)}>
                    <span className="line-clamp-2">{`Still ${String(opponentBook.Title ?? "this one")}`}</span>
                  </DuelButton>
                </div>
              </div>
            </div>
          )}

          {footer && <p className="text-sm text-(--color-text-dim)">{footer}</p>}

          {before && (
            <button type="button" onClick={() => void undo(before)} className={secondaryButtonClass}>
              Not finished? Undo
            </button>
          )}
        </div>
      </Sheet>
    </div>
  );
}
