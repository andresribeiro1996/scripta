import { useState } from "react";
import { bookKey, saveFailureMessage, upNextPair } from "@scripta/shared";
import { useLibrarySaver } from "../hooks/useLibrarySaver";
import { CoverImage } from "./BookCard";
import { DuelButton } from "./DuelButton";
import { Sheet } from "./Sheet";
import { useToast } from "./Toaster";

export function PickNextSheet({ keys, books, onClose }: { keys: string[]; books: Array<Record<string, unknown>>; onClose: () => void }) {
  const saver = useLibrarySaver();
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const [saving, setSaving] = useState(false);
  const pairKeys = upNextPair(keys, offset);
  const pair = pairKeys
    .map((key) => books.find((book) => bookKey(book) === key))
    .filter((book): book is Record<string, unknown> => Boolean(book));

  if (pairKeys.length < 2) return null;

  async function choose(book: Record<string, unknown>) {
    if (saving) return;
    setSaving(true);
    const result = await saver.submit({ kind: "book", bookKey: bookKey(book), readStatus: 1 });
    if (result.ok) onClose();
    else toast({ message: saveFailureMessage(result.error, "Couldn't save the status change."), kind: "error" });
    setSaving(false);
  }

  return (
    <Sheet title="Pick your next read" onClose={onClose}>
      <div className="grid grid-cols-2 gap-4 px-3 pb-4">
        {pair.map((book) => (
          <div key={bookKey(book)} className="flex flex-col gap-2">
            <div className="relative aspect-[2/3] overflow-hidden rounded-md bg-(--color-border)"><CoverImage book={book} /></div>
            <p className="line-clamp-2 min-h-[2lh] text-center text-sm">{String(book.Title ?? "Untitled")}</p>
            <DuelButton onClick={() => void choose(book)} disabled={saving}>
              This one<span className="sr-only">: {String(book.Title ?? "Untitled")}</span>
            </DuelButton>
          </div>
        ))}
      </div>
      {keys.length > 2 ? (
        <div className="px-3 pb-4">
          <button type="button" disabled={saving} onClick={() => setOffset((value) => value + 2)} className="min-h-11 w-full rounded-lg border border-(--color-border) px-3 py-2 text-sm font-semibold hover:bg-(--color-surface-hover) disabled:opacity-50">Another pair</button>
        </div>
      ) : null}
    </Sheet>
  );
}
