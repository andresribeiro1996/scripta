// "Sync with Goodreads" — the guided entry point for re-importing a
// Goodreads library CSV (LibraryPage's action menu / header button).
// Goodreads shut its public API down years ago, so like every other app
// (bookadoro included) "sync" here means: export the CSV from Goodreads,
// drop it here, and the same merge pipeline as any other import
// (LibraryPage's mergeAndSave) updates matched books in place — shelves,
// ratings and read dates included — and appends only genuinely new ones.
// The modal owns just the guidance and the file pick; all parsing and
// saving stays in the page.
//
// Same fixed-overlay modal shell as ShareModal.tsx/ConfirmDialog.tsx
// (bg-black/40 backdrop, click-outside-to-close, Escape-to-close).

import { useRef, useState } from "react";
import { useDismissible } from "../hooks/useDismissible";
import { useScrollLock } from "../hooks/useScrollLock";

export function SyncGoodreadsModal({
  onFile,
  onClose
}: {
  /** Runs the file through the normal import pipeline; rejects on a
   *  parse/save failure so the modal can show it and stay open. */
  onFile: (file: File) => Promise<void>;
  onClose: () => void;
}) {
  useScrollLock();
  useDismissible(onClose);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChosen(file: File) {
    setBusy(true);
    setError(null);
    try {
      await onFile(file);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sync that file.");
      setBusy(false);
    }
  }

  return (
    <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto overscroll-contain rounded-xl border border-(--color-border) bg-(--color-surface) p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Sync with Goodreads</h3>
          <button onClick={onClose} className="text-sm text-(--color-text-dim) hover:text-(--color-text)">
            Close
          </button>
        </div>

        <p className="mb-3 text-sm text-(--color-text-dim)">
          Goodreads has no API, so syncing runs off your library export — grab it like this:
        </p>
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm">
          <li>
            On goodreads.com, open <span className="font-semibold">My Books</span>
          </li>
          <li>
            In the left sidebar under Tools, click <span className="font-semibold">Import and Export</span>
          </li>
          <li>
            Click <span className="font-semibold">Export Library</span> — the download appears when it's ready
            (they also email you a link)
          </li>
        </ol>

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="rounded-lg bg-(--color-accent) px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Syncing…" : "Choose your Goodreads CSV…"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleChosen(file);
            e.target.value = "";
          }}
        />
        {error && <p className="mt-2 text-xs text-(--color-danger)">{error}</p>}

        <p className="mt-4 border-t border-(--color-border) pt-3 text-xs text-(--color-text-dim)">
          Books you already have are matched and updated in place — shelves, ratings, read dates — never duplicated.
          Re-sync any time by exporting again.
        </p>
      </div>
    </div>
  );
}
