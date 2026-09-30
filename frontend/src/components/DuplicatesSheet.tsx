import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { bookKey, markDistinct, statusLabel } from "@scripta/shared";
import { mergeLibraryBooks, type LibraryDocument } from "../api/library";
import { useLibrary } from "../hooks/useLibrary";
import { CoverImage } from "./BookCard";
import { Sheet } from "./Sheet";
import { useToast } from "./Toaster";

export function DuplicatesSheet({ groups, library, onClose }: { groups: string[][]; library: LibraryDocument; onClose: () => void }) {
  const { updateLibrary } = useLibrary();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const byKey = new Map(library.data.books.map((book) => [bookKey(book), book] as const));

  async function run(action: () => Promise<unknown>, failure: string) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      console.error(error);
      void queryClient.invalidateQueries({ queryKey: ["library"] });
      toast({ message: failure, kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  const merge = (group: string[]) =>
    run(async () => {
      const current = queryClient.getQueryData<LibraryDocument | null>(["library"]) ?? library;
      queryClient.setQueryData(["library"], await mergeLibraryBooks(group[0]!, group.slice(1), current.updatedAt));
    }, "Couldn't merge these books.");

  const keepApart = (group: string[]) => run(() => updateLibrary((data) => markDistinct(data, group)), "Couldn't save that.");

  return (
    <Sheet title="Possible duplicates" onClose={onClose}>
      <ul className="flex flex-col gap-4 px-3 pb-4">
        {groups.map((group) => (
          <li key={group.join("|")} className="flex flex-col gap-3 rounded-lg border border-(--color-border) p-3">
            {group.map((key) => {
              const book = byKey.get(key);
              if (!book) return null;
              return (
                <div key={key} className="flex items-center gap-3">
                  <div className="aspect-[2/3] w-12 shrink-0 overflow-hidden rounded bg-(--color-border)">
                    <CoverImage book={book} />
                  </div>
                  <div className="min-w-0 text-sm">
                    <p className="truncate font-semibold">{String(book.Title ?? "Untitled")}</p>
                    <p className="truncate text-(--color-text-dim)">{String(book.Attribution ?? "")}</p>
                    <p className="text-xs text-(--color-text-dim)">{[book.ISBN ? `ISBN ${String(book.ISBN)}` : null, statusLabel(book.ReadStatus)].filter(Boolean).join(" · ")}</p>
                  </div>
                </div>
              );
            })}
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => void merge(group)} className="min-h-11 flex-1 rounded-lg bg-(--color-accent) px-3 py-2 text-sm font-semibold text-(--color-on-accent) disabled:opacity-50">
                Merge
              </button>
              <button type="button" disabled={busy} onClick={() => void keepApart(group)} className="min-h-11 flex-1 rounded-lg border border-(--color-border) px-3 py-2 text-sm font-semibold hover:bg-(--color-surface-hover) disabled:opacity-50">
                Not the same
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
