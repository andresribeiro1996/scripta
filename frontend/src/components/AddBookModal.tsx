// "Add a book" — search Open Library by ISBN / title / author (or scan
// the ISBN barcode off the back cover with the camera), pick a result to
// autofill the form, adjust anything by hand, save. The modal only builds
// the book record (lib/bookSearch.ts's buildManualBook); LibraryPage's
// mergeAndSave runs it through the exact same merge/order/save pipeline
// as a file import, so adding a book you already have updates it instead
// of duplicating it, and the cover resolves on render through the normal
// /covers/resolve chain (ISBN first, then title+author) with no extra
// work here.
//
// The barcode scanner (@zxing/browser) is dynamically imported inside
// the scan effect so its ~300KB stays out of the main bundle for the
// 99% of sessions that never open a camera.
//
// Same fixed-overlay modal shell as ShareModal.tsx (bg-black/40 backdrop,
// click-outside-to-close, Escape-to-close, scroll-locked page behind).

import { useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import { useDismissible } from "../hooks/useDismissible";
import { useScrollLock } from "../hooks/useScrollLock";
import { normalizeIsbn } from "../lib/covers";
import { buildManualBook, searchBooks, type BookSearchResult } from "../lib/bookSearch";

const STATUS_OPTIONS = [
  { value: 2, label: "Finished" },
  { value: 1, label: "Reading" },
  { value: 0, label: "Not read" }
];

export function AddBookModal({
  onAdd,
  onClose
}: {
  /** Persists the built record; rejects on failure so the modal can show
   *  it and stay open. */
  onAdd: (book: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  useScrollLock();
  useDismissible(onClose);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BookSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const detectedRef = useRef(false);

  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [isbn, setIsbn] = useState("");
  const [publisher, setPublisher] = useState("");
  const [readStatus, setReadStatus] = useState(2);
  const [rating, setRating] = useState<number | null>(null);
  const [dateRead, setDateRead] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function selectResult(result: BookSearchResult) {
    setTitle(result.title);
    setAuthor(result.authors.join(", "));
    setIsbn(result.isbn ?? "");
    setPublisher(result.publisher ?? "");
    setResults(null);
  }

  async function runSearch(raw: string) {
    const q = raw.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    setResults(null);
    try {
      const found = await searchBooks(q);
      setResults(found);
      // The common case for an ISBN lookup (typed or scanned): exactly
      // one edition — skip the tap and go straight to the filled form.
      if (found.length === 1) selectResult(found[0]);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed — try again.");
    } finally {
      setSearching(false);
    }
  }

  // Live camera decode while `scanning` is on. ZXing's continuous
  // callback fires many times a second (including with "no code found"
  // errors, which are routine and ignored); the first plausible ISBN
  // digits win, everything after is a no-op via detectedRef. Cleanup
  // stops the stream even mid-startup (cancelled) so closing the modal
  // can never leave a camera light on.
  useEffect(() => {
    if (!scanning) return;
    detectedRef.current = false;
    let controls: IScannerControls | null = null;
    let cancelled = false;
    void (async () => {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      try {
        controls = await reader.decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result, err, ctl) => {
          if (result) {
            const text = result.getText().trim();
            // EAN-13 book barcodes are 978/979-prefixed; also accept bare
            // 10-digit scans from older/odd editions. Anything else
            // (product codes etc.) is ignored and scanning continues.
            if (!detectedRef.current && /^(?:\d{10}|\d{13})$/.test(text)) {
              detectedRef.current = true;
              ctl.stop();
              setScanning(false);
              setQuery(text);
              void runSearch(text);
            }
          } else if (err && err.name !== "NotFoundException" && !detectedRef.current) {
            setScanError(err.message || "The camera stream failed.");
          }
        });
        if (cancelled) controls.stop();
      } catch (err) {
        if (!cancelled) {
          // Almost always a denied permission or no camera on this
          // device — typing the ISBN by hand is right there.
          setScanError(
            err instanceof Error && /permission|notallowed|notfound/i.test(err.name + err.message)
              ? "Couldn't access the camera — check the permission, or type the ISBN instead."
              : "Couldn't start the camera — type the ISBN instead."
          );
          setScanning(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      controls?.stop();
    };
    // runSearch only touches setters; it's stable enough for this effect
    // (re-running it would just restart the camera).
    // oxlint-disable-next-line exhaustive-deps
  }, [scanning]);

  async function handleSave() {
    if (!title.trim() || !author.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onAdd(
        buildManualBook(
          {
            title: title.trim(),
            author: author.trim(),
            isbn: normalizeIsbn(isbn),
            publisher: publisher.trim() || null,
            readStatus,
            rating,
            dateRead: dateRead || null
          },
          crypto.randomUUID()
        )
      );
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't add that book.");
      setSaving(false);
    }
  }

  return (
    <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto overscroll-contain rounded-xl border border-(--color-border) bg-(--color-surface) p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Add a book</h3>
          <button onClick={onClose} className="text-sm text-(--color-text-dim) hover:text-(--color-text)">
            Close
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch(query);
          }}
          className="flex gap-2"
        >
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ISBN, title, or author"
            aria-label="Search for a book"
            className="min-w-0 flex-1 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={searching || query.trim() === ""}
            className="shrink-0 rounded-lg bg-(--color-accent) px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </form>
        <button
          onClick={() => {
            // getUserMedia simply doesn't exist outside a secure context
            // (plain http:// over the LAN, e.g. dev:mobile without the
            // cert — see scripts/test-on-phone.mjs --https). Catching it
            // here, before the black video box ever mounts, with the
            // actual reason beats zxing's opaque TypeError and the
            // generic "couldn't start" guess below.
            if (!navigator.mediaDevices?.getUserMedia) {
              setScanError("The camera needs a secure connection — open the app over https:// (or localhost), not a plain http:// address.");
              return;
            }
            setScanError(null);
            setScanning((prev) => !prev);
          }}
          className="mt-2 text-xs text-(--color-text-dim) underline transition-colors hover:text-(--color-text)"
        >
          {scanning ? "Stop scanning" : "Or scan the ISBN barcode with your camera"}
        </button>
        {searchError && <p className="mt-2 text-xs text-(--color-danger)">{searchError}</p>}
        {scanError && <p className="mt-2 text-xs text-(--color-danger)">{scanError}</p>}

        {scanning && (
          <div className="mt-3">
            <video ref={videoRef} className="aspect-video w-full rounded-lg bg-black" playsInline muted />
            <p className="mt-1.5 text-xs text-(--color-text-dim)">Point at the barcode on the back cover.</p>
          </div>
        )}

        {results !== null && !scanning && (
          <div className="mt-3 max-h-64 overflow-y-auto overscroll-contain rounded-lg border border-(--color-border)">
            {results.length === 0 && (
              <p className="p-3 text-xs text-(--color-text-dim)">
                No matches — fill the form in below by hand instead.
              </p>
            )}
            {results.map((r, i) => (
              <button
                key={i}
                onClick={() => selectResult(r)}
                className="flex w-full items-center gap-3 border-b border-(--color-border) p-2.5 text-left last:border-b-0 hover:bg-(--color-surface-hover)"
              >
                {r.coverUrl ? (
                  <img src={r.coverUrl} alt="" loading="lazy" className="h-16 w-11 shrink-0 rounded object-cover" />
                ) : (
                  <div className="h-16 w-11 shrink-0 rounded border border-(--color-border)" />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{r.title}</span>
                  <span className="block truncate text-xs text-(--color-text-dim)">
                    {[r.authors.join(", "), r.year].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 space-y-3 border-t border-(--color-border) pt-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold">Author</span>
            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
            />
          </label>
          <div className="flex gap-3">
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-xs font-semibold">ISBN</span>
              <input
                value={isbn}
                onChange={(e) => setIsbn(e.target.value)}
                inputMode="numeric"
                className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
              />
            </label>
            <label className="w-32">
              <span className="mb-1 block text-xs font-semibold">Rating</span>
              <select
                value={rating ?? ""}
                onChange={(e) => setRating(e.target.value === "" ? null : Number(e.target.value))}
                className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex gap-3">
            <label className="w-32">
              <span className="mb-1 block text-xs font-semibold">Status</span>
              <select
                value={readStatus}
                onChange={(e) => setReadStatus(Number(e.target.value))}
                className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 flex-1">
              <span className="mb-1 block text-xs font-semibold">Date read</span>
              <input
                type="date"
                value={dateRead}
                onChange={(e) => setDateRead(e.target.value)}
                disabled={readStatus !== 2}
                className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm disabled:opacity-50"
              />
            </label>
          </div>
          <button
            onClick={() => void handleSave()}
            disabled={saving || title.trim() === "" || author.trim() === ""}
            className="w-full rounded-lg bg-(--color-accent) px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Adding…" : "Add book"}
          </button>
          {saveError && <p className="text-xs text-(--color-danger)">{saveError}</p>}
        </div>
      </div>
    </div>
  );
}
