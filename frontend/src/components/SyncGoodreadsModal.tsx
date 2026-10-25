// "Sync with Goodreads" — the guided entry point for re-importing a
// Goodreads library CSV (LibraryPage's action menu / header button).
// Goodreads shut its public API down years ago, so like every other app
// (bookadoro included) "sync" here means: export the CSV from Goodreads,
// drop it here, and the same merge pipeline as any other import
// (LibraryPage's mergeAndSave) updates matched books in place — shelves,
// ratings and read dates included — and appends only genuinely new ones.
// The modal owns just the guidance and the file pick; all parsing and
// saving stays in the page.

import { useRef, useState } from "react";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "./page/buttonClasses";
import { Sheet } from "./Sheet";

export function SyncGoodreadsModal({
  onFile,
  onClose
}: {
  /** Runs the file through the normal import pipeline; rejects on a
   *  parse/save failure so the modal can show it and stay open. */
  onFile: (file: File) => Promise<void>;
  onClose: () => void;
}) {
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
    <Sheet
      title="Sync with Goodreads"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={busy} className={BUTTON_SECONDARY}>
            Cancel
          </button>
          <button onClick={() => fileInputRef.current?.click()} disabled={busy} className={BUTTON_PRIMARY}>
            {busy ? "Syncing…" : "Choose your Goodreads CSV…"}
          </button>
        </>
      }
    >
      <div className="px-2 pb-2">
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
            Click <span className="font-semibold">Export Library</span> — the download appears when it's ready (they also email you a link)
          </li>
        </ol>

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
        {error && <p className="mb-2 text-xs text-(--color-danger)">{error}</p>}

        <p className="border-t border-(--color-border) pt-3 text-xs text-(--color-text-dim)">
          Books you already have are matched and updated in place — shelves, ratings, read dates — never duplicated. Re-sync any time by
          exporting again.
        </p>
      </div>
    </Sheet>
  );
}
