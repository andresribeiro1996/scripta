import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  bookKey,
  favouriteOpponent,
  formatFinishDay,
  localDay,
  promoteFavourite,
  shelfAfterFinish,
  type FinishRating,
  type MuralBlock,
  type ReadSnapshot
} from "@scripta/shared";
import { fetchOwnProfile } from "../api/community";
import { useMurals } from "../hooks/useMurals";
import { CoverImage } from "./BookCard";
import { FeelingChips } from "./FeelingChips";
import { Sheet } from "./Sheet";

type Shelf = { id: string; original: MuralBlock[]; blocks: MuralBlock[] };
type Landing = "finished" | "favourites";

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
  before: ReadSnapshot;
  onSetRating: (book: Record<string, unknown>, rating: FinishRating) => Promise<boolean>;
  onAddNote: (book: Record<string, unknown>, text: string) => Promise<boolean>;
  onRestoreRead: (book: Record<string, unknown>, before: ReadSnapshot) => Promise<boolean>;
  onClose: () => void;
}) {
  const murals = useMurals();
  const own = useQuery({ queryKey: ["community", "own-profile"], queryFn: fetchOwnProfile });

  const key = bookKey(book);
  const [savedRating, setSavedRating] = useState(false);
  const [note, setNote] = useState("");
  const noteRef = useRef("");
  const settled = useRef(false);

  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [landed, setLanded] = useState<Landing[]>([]);
  const [shelfError, setShelfError] = useState<string | null>(null);
  const [favouriteChoiceMade, setFavouriteChoiceMade] = useState(false);
  const startedShelfUpdate = useRef(false);

  async function saveShelf(id: string, blocks: MuralBlock[]) {
    try {
      await murals.saveBlocks(id, blocks);
    } catch {
      setShelfError("Couldn't update your shelf.");
    }
  }

  async function updateShelf(rating: number | null) {
    const muralId = own.data?.muralId;
    if (!muralId) return;
    const current: Shelf = shelf ?? { id: muralId, original: murals.data?.find((m) => m.id === muralId)?.blocks ?? [], blocks: [] };
    const base = shelf ? shelf.blocks : current.original;
    const result = shelfAfterFinish(base, key, rating);
    setLanded((prev) => [...new Set([...prev, ...result.landed])]);
    setShelf({ ...current, blocks: result.blocks });
    if (result.blocks !== base) await saveShelf(muralId, result.blocks);
  }

  useEffect(() => {
    const muralId = own.data?.muralId;
    const muralBlocks = murals.data?.find((m) => m.id === muralId)?.blocks;
    if (!muralId || !muralBlocks || startedShelfUpdate.current) return;
    startedShelfUpdate.current = true;
    void updateShelf(typeof book.Rating === "number" ? book.Rating : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own.data?.muralId, murals.data]);

  function finish() {
    if (settled.current) return;
    settled.current = true;
    const text = noteRef.current.trim();
    if (text) void onAddNote(book, text);
  }

  function close() {
    finish();
    onClose();
  }

  async function handleRatingChange(rating: FinishRating) {
    setSavedRating(false);
    const ok = await onSetRating(book, rating);
    if (ok) {
      setSavedRating(true);
      void updateShelf(rating);
    }
  }

  async function chooseThisOne() {
    if (!shelf) return;
    const nextBlocks = promoteFavourite(shelf.blocks, key);
    setFavouriteChoiceMade(true);
    if (nextBlocks !== shelf.blocks) {
      setShelf({ ...shelf, blocks: nextBlocks });
      await saveShelf(shelf.id, nextBlocks);
    }
  }

  async function undo() {
    settled.current = true;
    const restored = await onRestoreRead(book, before);
    if (!restored) return;
    if (shelf && shelf.blocks !== shelf.original) await saveShelf(shelf.id, shelf.original);
    onClose();
  }

  const opponentKey = shelf ? favouriteOpponent(shelf.blocks, key) : null;
  const opponentBook = opponentKey ? (books.find((candidate) => bookKey(candidate) === opponentKey) ?? null) : null;

  const day = formatFinishDay(String(book.DateLastRead ?? localDay()));
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
              className="min-h-9 rounded-lg bg-(--color-accent) px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
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
                  <button type="button" onClick={() => void chooseThisOne()} className={secondaryButtonClass}>
                    This one
                  </button>
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  <div className="aspect-[2/3] w-full overflow-hidden rounded-lg bg-(--color-border)">
                    <CoverImage book={opponentBook} />
                  </div>
                  <button type="button" onClick={() => setFavouriteChoiceMade(true)} className={secondaryButtonClass}>
                    {`Still ${String(opponentBook.Title ?? "this one")}`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {footer && <p className="text-sm text-(--color-text-dim)">{footer}</p>}

          <button type="button" onClick={() => void undo()} className={secondaryButtonClass}>
            Not finished? Undo
          </button>
        </div>
      </Sheet>
    </div>
  );
}
