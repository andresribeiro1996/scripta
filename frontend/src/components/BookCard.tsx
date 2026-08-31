import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useState } from "react";
import { forgetResolvedCover, peekResolvedCover, resolveCover, type ResolveCoverParams } from "../api/covers";
import { normalizeImageId, normalizeIsbn, statusLabel } from "../lib/covers";
import { DEFAULT_LIBRARY_STYLE, cardFontFamilyCss, resolveBorderColor, type LibraryStyleSettings } from "../lib/libraryStyle";
import { bookKey } from "../lib/merge";

const BookIcon = () => (
  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="1.5">
    <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6.5A2.5 2.5 0 0 1 4 17.5v-13Z" />
    <path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H20" />
  </svg>
);

/** `book._coverUrl` first, if there is one — a genuine custom gallery
 *  cover (lib/bookCovers.ts's setBookCover), legacy data from before the
 *  backend's own cover cache existed, or a manually-supplied preview URL
 *  (LibraryStylePage.tsx's sample books). No network involved at all in
 *  that case; it's used exactly as given. Otherwise, one call to the
 *  backend's cache-aware GET /covers/resolve (api/covers.ts) — the ENTIRE
 *  cover-resolution chain (Kobo CDN, Open Library, Google Books,
 *  Hardcover, and a global cache checked before any of those) now lives
 *  server-side; see lib/covers.ts's own top comment for why it moved
 *  there and backend/src/modules/covers for where it lives now. Renders
 *  the fallback icon until — and unless — something resolves.
 *
 *  If the confirmed URL itself fails to load (a stale external URL from
 *  before the cache existed, most likely — a real custom cover practically
 *  never 404s, since it's served from this app's own storage), falls
 *  through to a fresh backend lookup rather than giving up outright.
 *
 *  Reports whether it currently has *something* to show (an image it's
 *  displaying or attempting, not necessarily confirmed loaded yet) via
 *  onHasCoverChange — BookCard needs that to decide whether the
 *  title/author overlay is allowed to hide (see its `showTitleAuthor`
 *  prop: a book with no cover always shows them).
 *
 *  Exported so murals' book blocks (components/murals/blocks/BookBlocks.tsx
 *  — Spotlight/Shelf/Currently Reading) can reuse the exact same
 *  cover/gallery-fallback chain instead of re-implementing it; needs a
 *  `position: relative` parent with a defined size, same as BookCard's own
 *  root div supplies below.
 *
 *  `fit` defaults to `"cover"` (crop-to-fill — right for BookCard's own
 *  card-sized/near-cover-proportioned use) but `MiniBookTile`'s small
 *  mural tiles pass `"contain"`: at a fixed, non-cover-proportioned box
 *  (see BookBlocks.tsx's tier-list tiles specifically), `cover` was
 *  cropping a meaningful chunk off every cover's top/bottom or sides —
 *  fine at BookCard's larger, closer-to-natural-ratio size, much more
 *  noticeable once shrunk down. `contain` always shows the WHOLE cover,
 *  letterboxed into the tile's own background (`bg-(--color-border)` on
 *  every caller, already there for the no-cover placeholder state) rather
 *  than cropped, at the cost of not filling every pixel of a
 *  mismatched-ratio box — the right trade for a small preview tile where
 *  seeing the whole cover matters more than a flush edge-to-edge fill. */
function coverParamsFor(book: Record<string, unknown>): ResolveCoverParams {
  const isbn = normalizeIsbn(book.ISBN);
  const imageId = normalizeImageId(book.ImageId);
  const title = String(book.Title ?? "").trim();
  return {
    isbn: isbn || undefined,
    imageId: imageId || undefined,
    title: title || undefined,
    author: book.Attribution ? String(book.Attribution) : undefined
  };
}

export function CoverImage({
  book,
  onHasCoverChange,
  fit = "cover",
  alt = ""
}: {
  book: Record<string, unknown>;
  onHasCoverChange?: (hasCover: boolean) => void;
  fit?: "cover" | "contain";
  alt?: string;
}) {
  const confirmedUrl = typeof book._coverUrl === "string" ? book._coverUrl : null;
  const [confirmedFailed, setConfirmedFailed] = useState(false);
  const [autoUrl, setAutoUrl] = useState<string | null>(() => peekResolvedCover(coverParamsFor(book)) ?? null);
  const useAuto = !confirmedUrl || confirmedFailed;

  // Book identity (or the confirmed URL specifically) changed — reset
  // both, so a stale result from the PREVIOUS book never briefly shows
  // for this one while the fresh lookup below is still in flight.
  useEffect(() => {
    setConfirmedFailed(false);
    setAutoUrl(peekResolvedCover(coverParamsFor(book)) ?? null);
  }, [book, confirmedUrl]);

  useEffect(() => {
    if (!useAuto) return;
    const params = coverParamsFor(book);
    if (!params.isbn && !params.imageId && !params.title) return; // nothing to even ask the backend about
    const cached = peekResolvedCover(params);
    if (cached !== undefined) {
      setAutoUrl(cached);
      return;
    }
    let cancelled = false;
    resolveCover(params)
      .then((url) => {
        if (!cancelled) setAutoUrl(url);
      })
      .catch(() => {
        // A real failure (network, auth, a malformed request) — same
        // "no cover found" outcome as a genuine miss, never a thrown
        // error surfaced to the user over a background image lookup.
        if (!cancelled) setAutoUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [useAuto, book]);

  const currentSrc = useAuto ? (autoUrl ?? undefined) : confirmedUrl!;
  const hasCover = Boolean(currentSrc);

  useEffect(() => {
    onHasCoverChange?.(hasCover);
  }, [hasCover, onHasCoverChange]);

  return (
    <>
      {currentSrc ? (
        <img
          src={currentSrc}
          alt={alt}
          // Deliberately no loading="lazy" — proven unreliable for this
          // app already (see viewer's cover-loading fix): the browser's
          // intersection-based trigger sometimes just never fires, even
          // for cards already in the viewport. Eager loading is a fine
          // trade-off for a personal library (at most a few hundred
          // covers).
          className={`absolute inset-0 h-full w-full ${fit === "contain" ? "object-contain" : "object-cover"}`}
          onError={() => {
            if (!useAuto) setConfirmedFailed(true); // the confirmed/legacy URL broke — fall through to a fresh backend lookup
            else {
              // the resolved URL itself broke — drop it from the local cache so the next mount retries, then give up for now
              forgetResolvedCover(coverParamsFor(book));
              setAutoUrl(null);
            }
          }}
        />
      ) : (
        // Just the icon — BookCard's own bottom overlay always renders the
        // title/author regardless of whether a cover resolved, so
        // repeating them here would double them up.
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-linear-to-br from-(--color-accent-soft) to-(--color-border)">
          <BookIcon />
        </div>
      )}
    </>
  );
}

export function BookCard({
  book,
  onClick,
  // Defaults to the stock look BookCard hardcoded before /dashboard/style
  // grew a `style` prop, for the handful of call sites (if any) that
  // don't pass one explicitly.
  style = DEFAULT_LIBRARY_STYLE,
  reorderable = false,
  onOpenStyle,
  onOpenCoverPicker,
  selectable = false,
  selected = false,
  onToggleSelect
}: {
  book: Record<string, unknown>;
  onClick: () => void;
  /** Every card-appearance setting, already resolved through the full
   *  library → series → book priority chain (see lib/libraryStyle.ts's
   *  effectiveCardStyle) by the caller — BookCard itself has no opinion
   *  on where a value came from, just renders it. */
  style?: LibraryStyleSettings;
  /** Enables drag-to-reorder (LibraryPage.tsx only — Series/Collections
   *  detail views and the style-page preview don't pass this). Ignored
   *  while `selectable` — selecting and dragging don't mix. */
  reorderable?: boolean;
  /** Shows a small "Style" button (top-left, visible on hover) opening
   *  this book's own style override — see PerCardStylePanel.tsx and
   *  book._style. Omitted entirely (no button rendered) wherever editing
   *  wouldn't make sense — the style-page preview's placeholder books,
   *  the book-picker modal's plain list. Hidden while `selectable`, same
   *  as dragging — one mode at a time. */
  onOpenStyle?: (book: Record<string, unknown>) => void;
  /** Shows a small "Cover" button (top-left, stacked under "Style" when
   *  both are present, visible on hover) opening CoverPickerModal.tsx to
   *  assign one of the account's gallery images (see
   *  hooks/useGalleryImages.ts) as this book's cover — see
   *  lib/bookCovers.ts's setBookCover, which just sets `book._coverUrl`
   *  the same way a successfully auto-resolved cover would. Same
   *  omit-where-it-wouldn't-make-sense and hidden-while-`selectable`
   *  rules as `onOpenStyle`. */
  onOpenCoverPicker?: (book: Record<string, unknown>) => void;
  /** Turns the whole card into a selection target — an always-visible
   *  checkbox (top-left) instead of the hover-only Style button, and
   *  clicking anywhere on the card toggles selection instead of firing
   *  `onClick`. Driven by a page-level "Select" toggle (LibraryPage.tsx /
   *  GroupsPage.tsx) for bulk delete — see their `selectionMode` state
   *  and `handleDeleteSelected`. */
  selectable?: boolean;
  /** Whether this card is currently selected — only meaningful when
   *  `selectable`. */
  selected?: boolean;
  onToggleSelect?: (book: Record<string, unknown>) => void;
}) {
  const label = statusLabel(book.ReadStatus);
  const highlights = Array.isArray(book.highlights) ? book.highlights.length : 0;
  const [hasCover, setHasCover] = useState(false);
  const key = bookKey(book);
  const dragEnabled = reorderable && !selectable;
  const { attributes, listeners, setNodeRef: setDragNodeRef, transform, isDragging } = useDraggable({ id: key, disabled: !dragEnabled });
  const { setNodeRef: setDropNodeRef, isOver } = useDroppable({ id: key, disabled: !reorderable });
  const dropTarget = isOver && !isDragging;
  const setRefs = (el: HTMLDivElement | null) => {
    setDragNodeRef(el);
    setDropNodeRef(el);
  };
  const showOverlayText = style.showTitleAuthor || !hasCover;

  // Same ratio between the gradient's near-stop and mid-stop the old
  // hardcoded 0.88/0.55 opacities had (0.55/0.88 ≈ 0.625) — scaling both
  // together as overlayIntensity changes keeps the gradient's shape, just
  // stronger or weaker.
  const scrimPeak = style.overlayIntensity / 100;
  const scrimMid = scrimPeak * 0.625;

  // The overlay text's actual color, resolved once — `null` means white
  // (see LibraryStyleSettings.cardTextColor's own comment for why that's
  // the default here specifically, unlike most other "null means theme
  // default" fields in this app). Author/status keep the same relative
  // opacity hierarchy the old hardcoded text-white/82 and text-white/60
  // classes had, now applied as real `opacity` on top of whichever color
  // is chosen rather than baked into the color itself.
  const overlayTextColor = style.cardTextColor ?? "#ffffff";

  // A stable, CSS-<custom-ident>-safe name so the View Transitions API
  // (see LibraryPage.tsx's handleReorder) can recognize "this is the same
  // card" across a reorder and animate it sliding to its new slot instead
  // of just popping there. Only set when draggable — that's only ever
  // true on the Library page, which is the only place reordering happens;
  // scoping it there avoids ever having two simultaneously-rendered cards
  // for the same book (e.g. across different Series/Collections group
  // blocks) fight over the same name.
  const viewTransitionName = reorderable ? `book-${key.replace(/[^a-zA-Z0-9_-]/g, "_")}` : undefined;

  return (
    <div
      ref={setRefs}
      {...(dragEnabled ? { ...attributes, ...listeners } : {})}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || (e.key === " " && !dragEnabled)) {
          e.preventDefault();
          if (selectable) onToggleSelect?.(book);
          else onClick();
        }
      }}
      onClick={selectable ? () => onToggleSelect?.(book) : onClick}
      style={{
        aspectRatio: style.cardAspectRatio,
        borderRadius: `${style.cardRadius}px`,
        opacity: style.cardOpacity / 100,
        // Per-side presence: width is shared by whichever sides are on
        // (see BorderSides in lib/libraryStyle.ts) — a side that's off
        // gets 0 regardless of the shared width/style/color.
        borderTopWidth: `${style.cardBorderSides.top ? style.cardBorderWidth : 0}px`,
        borderRightWidth: `${style.cardBorderSides.right ? style.cardBorderWidth : 0}px`,
        borderBottomWidth: `${style.cardBorderSides.bottom ? style.cardBorderWidth : 0}px`,
        borderLeftWidth: `${style.cardBorderSides.left ? style.cardBorderWidth : 0}px`,
        borderStyle: style.cardBorderWidth > 0 ? style.cardBorderStyle : "none",
        borderColor: resolveBorderColor(style.cardBorderColor, style.cardBorderOpacity),
        outline: selected ? "3px solid var(--color-accent)" : dropTarget ? "2px solid var(--color-accent)" : undefined,
        outlineOffset: 2,
        viewTransitionName,
        transform: isDragging ? CSS.Translate.toString(transform) : undefined,
        zIndex: isDragging ? 10 : undefined,
        // Sets the base for the title/author/status overlay text below —
        // sized in `em` specifically so it responds to this (see
        // components/murals/MuralCanvas.tsx's identical reasoning for
        // mural blocks). font-family cascades to every descendant
        // (including the Style/Cover/highlight-count chrome, harmlessly);
        // fontSize only affects children with no explicit size of their
        // own, so those chrome elements' fixed `text-[10.5px]` stay fixed
        // regardless.
        fontFamily: cardFontFamilyCss(style.cardFontFamily),
        fontSize: `${style.cardFontSize}px`
      }}
      className={`group relative cursor-pointer overflow-hidden bg-(--color-border) transition-transform ${style.cardShadow ? "shadow-sm" : ""} ${style.cardHoverEffect && !selectable ? "hover:-translate-y-0.5 hover:scale-[1.01] hover:shadow-lg" : ""} ${dragEnabled ? "select-none" : ""} ${isDragging ? "touch-none opacity-60" : ""}`}
    >
      <CoverImage book={book} onHasCoverChange={setHasCover} alt={showOverlayText ? "" : String(book.Title ?? "Book cover")} />

      {selectable && (
        <>
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute top-2.5 left-2.5 flex h-6 w-6 items-center justify-center rounded-full border-2 backdrop-blur-xs ${selected ? "border-(--color-accent) bg-(--color-accent)" : "border-white/70 bg-[rgba(10,8,6,0.4)]"}`}
          >
            {selected && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect?.(book)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select ${String(book.Title ?? "this book")}`}
            className="absolute top-2.5 left-2.5 h-6 w-6 cursor-pointer appearance-none bg-transparent"
          />
        </>
      )}

      {((onOpenStyle || onOpenCoverPicker) && !selectable) && (
        <div className="absolute top-2.5 left-2.5 flex flex-col items-start gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 [@media(pointer:coarse)]:hidden">
          {onOpenStyle && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenStyle(book);
              }}
              title={book._style ? "Edit this book's custom style" : "Give this book its own style"}
              className={`rounded-full px-2.5 py-1 text-[10.5px] font-semibold text-white backdrop-blur-xs ${book._style ? "bg-(--color-accent)" : "bg-[rgba(10,8,6,0.72)]"}`}
            >
              Style
            </button>
          )}
          {onOpenCoverPicker && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenCoverPicker(book);
              }}
              title={book._coverImageId ? "Change this book's custom cover" : "Set a custom cover from your gallery"}
              className={`rounded-full px-2.5 py-1 text-[10.5px] font-semibold text-white backdrop-blur-xs ${book._coverImageId ? "bg-(--color-accent)" : "bg-[rgba(10,8,6,0.72)]"}`}
            >
              Cover
            </button>
          )}
        </div>
      )}

      {/* Dark scrim only when there's overlay text to keep legible — with
          text hidden and a real cover showing, nothing should dim the
          artwork. pointer-events: none is load-bearing, not decoration —
          without it this `inset-0` div (rendered on top, in paint order,
          of the Style button above) swallows every click over the whole
          card despite being visually transparent for most of its area,
          silently breaking it. Was live for every no-cover book
          unconditionally (`!hasCover` forces the scrim on regardless of
          the showTitleAuthor setting) and for any covered book too under
          the default (on) showTitleAuthor setting. */}
      {showOverlayText && (
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to top, rgba(10,8,6,${scrimPeak}) 0%, rgba(10,8,6,${scrimMid}) 32%, rgba(10,8,6,0) 62%)`,
            pointerEvents: "none"
          }}
        />
      )}

      {highlights > 0 && (
        <div className="absolute top-2.5 right-2.5 rounded-full bg-[rgba(10,8,6,0.72)] px-2.5 py-1 text-[10.5px] font-semibold text-white backdrop-blur-xs">
          {highlights} highlight{highlights === 1 ? "" : "s"}
        </div>
      )}

      {showOverlayText && (
        <div className="absolute right-0 bottom-0 left-0 p-3.5">
          {/* Sizes are `em`, relative to the root's cardFontSize (see its
              style comment above) — text-shadow stays unconditional for
              legibility over the cover art regardless of chosen color.
              Author/status have no text-shadow of their own (matches the
              pre-existing look) but keep the same relative opacity the
              old hardcoded text-white/82 and text-white/60 classes had,
              now layered on top of whichever color is actually chosen.
              fontWeight/fontStyle are set explicitly on each element
              (`undefined` when off, not `"normal"`) rather than left to
              inherit from the root — status already carries its own
              `font-medium` class, which would otherwise block inheriting
              a bold weight from further up; `undefined` still lets that
              class's own 500 weight show through unchanged when the
              toggle is off, matching the pre-existing look exactly. */}
          <h3
            className="mb-0.5 text-[1.15em] leading-tight [text-shadow:0_1px_3px_rgba(0,0,0,0.4)]"
            style={{ color: overlayTextColor, fontWeight: style.cardBold ? 700 : undefined, fontStyle: style.cardItalic ? "italic" : undefined }}
          >
            {String(book.Title ?? "Untitled")}
          </h3>
          <div
            className="mb-1 text-[0.9em]"
            style={{ color: overlayTextColor, opacity: 0.82, fontWeight: style.cardBold ? 700 : undefined, fontStyle: style.cardItalic ? "italic" : undefined }}
          >
            {String(book.Attribution ?? "Unknown author")}
          </div>
          <div
            className="text-[0.8em] font-medium"
            style={{ color: overlayTextColor, opacity: 0.6, fontWeight: style.cardBold ? 700 : undefined, fontStyle: style.cardItalic ? "italic" : undefined }}
          >
            {label}
          </div>
        </div>
      )}
    </div>
  );
}
