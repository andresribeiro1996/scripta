// The seeding step for a bracket: `bracketSize` empty slots, filled
// either by "Random fill" (server-side: shuffles the account's whole
// library and picks `bracketSize` books, see ArenaSeedPage.tsx's
// handleRandomFill) or by clicking a slot and picking a book from a
// search list (reusing BookSearchList — the same searchable
// click-to-select list murals' block editors already use for exactly
// this "pick a book from my library" interaction).
//
// Purely local/controlled — ArenaSeedPage.tsx owns actually persisting
// `slots` via PUT /arenas/:id/slots or POST /arenas/:id/random-fill (the
// latter via the `onRandomFill` prop, since that round-trip picks the
// books AND assigns slots server-side — this component never runs the
// shuffle itself).

import { useState } from "react";
import type { SeedBook } from "../../api/arena";
import { useLibrary } from "../../hooks/useLibrary";
import { toSeedBook } from "../../lib/arenaSeed";
import { bookKey } from "../../lib/merge";
import { CoverImage } from "../BookCard";
import { BookSearchList } from "../murals/pickers";

export function SeedSlotGrid({
  bracketSize,
  slots,
  onChange,
  onRandomFill
}: {
  bracketSize: number;
  slots: Array<SeedBook | null>;
  onChange: (slots: Array<SeedBook | null>) => void;
  /** Triggers the server-side random fill (ArenaSeedPage.tsx owns the
   *  actual call + persisting the result) — see this file's own header
   *  comment for why the shuffle doesn't happen here. */
  onRandomFill: () => void;
}) {
  const { data: library } = useLibrary();
  const books = ((library?.data as { books?: Array<Record<string, unknown>> } | undefined)?.books ?? []) as Array<Record<string, unknown>>;
  const [pickingSlot, setPickingSlot] = useState<number | null>(null);
  const usedKeys = new Set(slots.filter((s): s is SeedBook => s !== null).map((s) => s.key));
  const filledCount = slots.filter(Boolean).length;

  async function assignSlot(index: number, book: Record<string, unknown>) {
    const seedBook = await toSeedBook(book);
    const next = [...slots];
    next[index] = seedBook;
    onChange(next);
    setPickingSlot(null);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-(--color-text-dim)">
          {filledCount} / {bracketSize} slots filled
        </p>
        <button
          onClick={onRandomFill}
          disabled={books.length < bracketSize}
          title={books.length < bracketSize ? `Your library needs at least ${bracketSize} books to random-fill.` : undefined}
          className="rounded-lg bg-(--color-accent) px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Random fill
        </button>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {slots.map((slot, i) => (
          <button
            key={i}
            onClick={() => setPickingSlot(i)}
            className="flex aspect-2/3 flex-col items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-(--color-border) bg-(--color-surface) text-xs text-(--color-text-dim) hover:border-(--color-accent)"
          >
            {slot ? (
              <div className="relative h-full w-full">
                <CoverImage book={{ Title: slot.title, Attribution: slot.author, _coverUrl: slot.cover ?? undefined }} />
              </div>
            ) : (
              <span>Slot {i + 1}</span>
            )}
          </button>
        ))}
      </div>

      {pickingSlot !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPickingSlot(null)}>
          <div
            className="w-full max-w-md rounded-xl border border-(--color-border) bg-(--color-surface) p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-sm font-semibold">Pick a book for slot {pickingSlot + 1}</h3>
            <BookSearchList
              books={books.filter((b) => !usedKeys.has(bookKey(b)))}
              onSelect={(book) => void assignSlot(pickingSlot, book)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
