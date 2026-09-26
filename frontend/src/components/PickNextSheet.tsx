import { useState } from "react";
import { bookKey, localDay, setReadStatus } from "@scripta/shared";
import { useLibrary } from "../hooks/useLibrary";
import { CoverImage } from "./BookCard";
import { DuelButton } from "./DuelButton";
import { Sheet } from "./Sheet";
import { useToast } from "./Toaster";

export function PickNextSheet({ keys, books, onClose }: { keys: string[]; books: Array<Record<string, unknown>>; onClose: () => void }) {
  const { updateLibrary } = useLibrary();
  const toast = useToast();
  const [offset, setOffset] = useState(0);
  const [saving, setSaving] = useState(false);
  const pair = [keys[offset % keys.length], keys[(offset + 1) % keys.length]]
    .map((key) => books.find((book) => bookKey(book) === key))
    .filter((book): book is Record<string, unknown> => Boolean(book));

  async function choose(book: Record<string, unknown>) {
    if (saving) return;
    setSaving(true);
    const key = bookKey(book);
    const day = localDay();
    try {
      await updateLibrary((data) => ({ ...data, books: data.books.map((b) => (bookKey(b) === key ? setReadStatus(b, 1, day) : b)) }));
      onClose();
    } catch {
      toast({ message: "Couldn't save the status change.", kind: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet title="Pick your next read" onClose={onClose}>
      <div className="grid grid-cols-2 gap-4 px-3 pb-4">
        {pair.map((book) => (
          <div key={bookKey(book)} className="flex flex-col gap-2">
            <div className="aspect-[2/3] overflow-hidden rounded-md bg-(--color-border)"><CoverImage book={book} /></div>
            <p className="line-clamp-2 text-center text-sm">{String(book.Title ?? "Untitled")}</p>
            <DuelButton onClick={() => void choose(book)} disabled={saving}>This one</DuelButton>
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
