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
import { useT } from "../i18n";

export function SyncGoodreadsModal({
  onFile,
  onClose
}: {
  /** Runs the file through the normal import pipeline; rejects on a
   *  parse/save failure so the modal can show it and stay open. */
  onFile: (file: File) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
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
      setError(err instanceof Error ? err.message : t("addBook.syncFailed"));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={t("addBook.syncTitle")}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={busy} className={BUTTON_SECONDARY}>
            {t("shell.cancel")}
          </button>
          <button onClick={() => fileInputRef.current?.click()} disabled={busy} className={BUTTON_PRIMARY}>
            {busy ? t("addBook.syncing") : t("addBook.syncChooseCsv")}
          </button>
        </>
      }
    >
      <div className="px-2 pb-2">
        <p className="mb-3 text-sm text-(--color-text-dim)">
          {t("addBook.syncIntro")}
        </p>
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm">
          {(
            [
              ["addBook.syncStepOne", "My Books"],
              ["addBook.syncStepTwo", "Import and Export"],
              ["addBook.syncStepThree", "Export Library"]
            ] as const
          ).map(([key, goodreadsLabel]) => {
            const [before, after] = t(key).split("{name}");
            return (
              <li key={key}>
                {before}
                <span className="font-semibold">{goodreadsLabel}</span>
                {after}
              </li>
            );
          })}
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
          {t("addBook.syncNote")}
        </p>
      </div>
    </Sheet>
  );
}
