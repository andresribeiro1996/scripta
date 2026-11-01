import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bookKey,
  createShelfSession,
  favouriteOpponent,
  formatFinishDay,
  intlLocale,
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
import { BUTTON_PRIMARY, FIELD_CLASS } from "./page/buttonClasses";
import { DuelButton } from "./DuelButton";
import { FeelingChips } from "./FeelingChips";
import { Sheet } from "./Sheet";
import { useToast } from "./Toaster";
import { useLocale, useT } from "../i18n";

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
  const locale = useLocale();
  const t = useT();
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
    if (mounted.current) setShelfError(t("addBook.shelfUpdateFailed"));
    else toast({ message: t("addBook.shelfUpdateFailed"), kind: "error" });
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
      onChange: (state) => { if (mounted.current) setShelf(state); },
      locale
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
      setShelfError(t("addBook.shelfUpdateFailed"));
      return;
    }
    onClose();
  }

  const opponentKey = shelf ? favouriteOpponent(shelf.blocks, key) : null;
  const opponentBook = opponentKey ? (books.find((candidate) => bookKey(candidate) === opponentKey) ?? null) : null;

  const day = formatFinishDay(typeof book.DateLastRead === "string" ? book.DateLastRead : localDay(), intlLocale(locale));
  const landed = shelf?.landed ?? [];
  const footer =
    landed.length === 0
      ? null
      : landed.includes("favourites")
        ? t("addBook.addedToFinishedFavourites")
        : t("addBook.addedToFinished");

  return (
    <div className="relative z-[60]">
      <Sheet title={t("addBook.finishedTitle")} onClose={close}>
        <div className="flex flex-col gap-5 p-3">
          {shelfError && <p className="rounded-lg bg-(--color-danger-soft) px-3 py-2 text-sm text-(--color-danger)">{shelfError}</p>}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-(--color-text-dim)">{t("addBook.finishedOn", { day })}</p>
            <button
              type="button"
              onClick={close}
              className={BUTTON_PRIMARY}
            >
              {t("addBook.done")}
            </button>
          </div>

          <div className="flex gap-4">
            <div className="relative aspect-[2/3] w-24 shrink-0 overflow-hidden rounded-lg bg-(--color-border)">
              <CoverImage book={book} />
            </div>
            <div className="min-w-0 flex flex-col justify-center">
              <p className="font-bold">{String(book.Title ?? t("library.untitled"))}</p>
              <p className="mt-1 text-(--color-text-dim)">{String(book.Attribution ?? t("library.unknownAuthor"))}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold">{t("addBook.howDidItLand")}</p>
            <FeelingChips
              value={typeof book.Rating === "number" ? book.Rating : null}
              onChange={(rating) => void handleRatingChange(rating)}
            />
            {savedRating && <p className="text-xs text-(--color-text-dim)">{t("addBook.savedAsRating")}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold">{t("addBook.thoughtToKeep")}</p>
            <textarea
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
                noteRef.current = e.target.value;
              }}
              placeholder={t("addBook.thoughtPlaceholder")}
              rows={4}
              aria-label={t("addBook.thoughtToKeepLabel")}
              className={`${FIELD_CLASS} w-full resize-none`}
            />
          </div>

          {opponentBook && !favouriteChoiceMade && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold">{t("addBook.againstFavourite")}</p>
              <div className="flex gap-4">
                <div className="flex flex-1 flex-col gap-2">
                  <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-(--color-border)">
                    <CoverImage book={book} />
                  </div>
                  <DuelButton onClick={() => void chooseThisOne()}>{t("addBook.thisOne")}</DuelButton>
                </div>
                <div className="flex flex-1 flex-col gap-2">
                  <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-(--color-border)">
                    <CoverImage book={opponentBook} />
                  </div>
                  <DuelButton onClick={() => setFavouriteChoiceMade(true)}>
                    <span className="line-clamp-2">{t("addBook.stillTitle", { title: String(opponentBook.Title ?? t("addBook.thisOneLower")) })}</span>
                  </DuelButton>
                </div>
              </div>
            </div>
          )}

          {footer && <p className="text-sm text-(--color-text-dim)">{footer}</p>}

          {before && (
            <button type="button" onClick={() => void undo(before)} className={secondaryButtonClass}>
              {t("addBook.notFinishedUndo")}
            </button>
          )}
        </div>
      </Sheet>
    </div>
  );
}
