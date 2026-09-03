import { useEffect, useRef, useState } from "react";
import { BookCard } from "../components/BookCard";
import { BookGrid } from "../components/BookGrid";
import { LibraryCanvas } from "../components/LibraryCanvas";
import { PageContainer } from "../components/PageContainer";
import { CardAppearanceSection, CardBorderSection, CardContentSection, CardTextSection, Section, SliderRow } from "../components/StyleControls";
import { useLibrary } from "../hooks/useLibrary";
import {
  CARD_GAP_RANGE,
  CARD_MIN_WIDTH_RANGE,
  CONTENT_MAX_WIDTH_RANGE,
  CONTENT_PADDING_RANGE,
  DEFAULT_LIBRARY_STYLE,
  resolveLibraryStyle,
  type LibraryStyleSettings,
  type PerCardStyle
} from "../lib/libraryStyle";

// A flat-color SVG, inlined as a data: URI — stands in for a "real cover"
// in the preview below without spending an actual network request on one.
// BookCard checks `_coverUrl` before ever trying the network (see
// CoverImage in BookCard.tsx), so setting it here is enough to make it
// treat the book as having a cover.
const SAMPLE_COVER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='300'%3E%3Crect width='200' height='300' fill='%235b7a9d'/%3E%3C/svg%3E";

// Placeholder books for the live preview when the account doesn't have any
// real ones yet. Two have no ISBN/ImageId/_coverUrl at all, so BookCard
// falls straight to its icon-only fallback panel — the other two carry a
// `_coverUrl` (see above) so the "Show title and author" toggle actually
// has something to demonstrate: with a cover, hiding the text is possible;
// without one, BookCard keeps showing it regardless of the setting.
const PREVIEW_BOOKS: Array<Record<string, unknown>> = [
  { ContentID: "preview-1", Title: "Sample Book One", Attribution: "A. Author", ReadStatus: 1, ___PercentRead: 55, highlights: [], _coverUrl: SAMPLE_COVER },
  { ContentID: "preview-2", Title: "Sample Book Two", Attribution: "B. Author", ReadStatus: 2, ___PercentRead: 100, highlights: [{ BookmarkID: "p1" }], _coverUrl: SAMPLE_COVER },
  { ContentID: "preview-3", Title: "Sample Book Three (no cover)", Attribution: "C. Author", ReadStatus: 0, ___PercentRead: 0, highlights: [] },
  { ContentID: "preview-4", Title: "Sample Book Four (no cover)", Attribution: "D. Author", ReadStatus: 1, ___PercentRead: 20, highlights: [] }
];

export function LibraryStylePage() {
  const { data: library, updateLibrary } = useLibrary();

  const [draft, setDraft] = useState<LibraryStyleSettings>(DEFAULT_LIBRARY_STYLE);
  const syncedRef = useRef(false);

  // Hydrate the draft from the saved style exactly once, the first time
  // the library document actually loads (it's `undefined` on the very
  // first render — React Query hasn't resolved yet). Not a plain
  // `useState(() => ...)` initializer because that value isn't known yet
  // at mount time.
  useEffect(() => {
    if (!syncedRef.current && library !== undefined) {
      setDraft(resolveLibraryStyle(library?.data.style));
      syncedRef.current = true;
    }
  }, [library]);

  const saveTimerRef = useRef<number | undefined>(undefined);

  function applyDraft(next: LibraryStyleSettings) {
    setDraft(next);
    // Sliders fire on every drag tick — debounce so dragging doesn't spam
    // PUT /library, same pattern as LibraryPage's cover-confirmation flush.
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void updateLibrary((data) => ({ ...data, style: next }));
    }, 400);
  }

  function saveNow(next: LibraryStyleSettings) {
    setDraft(next);
    window.clearTimeout(saveTimerRef.current);
    void updateLibrary((data) => ({ ...data, style: next }));
  }

  // The shared per-card sections (Card appearance/border/content) only
  // know about PerCardStyle, not the full LibraryStyleSettings (they're
  // reused as-is by SeriesStylePanel, which only ever edits that subset)
  // — these two just merge a partial patch into the full draft.
  function applyCardPatch(patch: Partial<PerCardStyle>) {
    applyDraft({ ...draft, ...patch });
  }
  function saveCardPatchNow(patch: Partial<PerCardStyle>) {
    saveNow({ ...draft, ...patch });
  }

  const previewBooks = library?.data.books.length ? library.data.books.slice(0, 4) : PREVIEW_BOOKS;
  const usingCustomBackground = draft.backgroundColor !== null;

  return (
    <PageContainer>
      <header className="mb-6">
        <h2 className="text-lg font-bold">Library style</h2>
        <p className="text-sm text-(--color-text-dim)">
          Everything about how your cards and the canvas behind them look — applied across Library, Series, and
          Collections. These settings stay inside your books: they never restyle the app's own menus, page headers, or
          search and filter bar. A series can override its own card appearance from its own style panel (Series page) —
          those settings take priority over these for that series' cards.
        </p>
      </header>

      <div className="mb-6 grid gap-6 sm:grid-cols-2">
        <Section title="Card layout">
          <SliderRow id="card-size" label="Card size" value={draft.cardMinWidth} range={CARD_MIN_WIDTH_RANGE} onChange={(v) => applyDraft({ ...draft, cardMinWidth: v })} />
          <SliderRow id="card-gap" label="Spacing between cards" value={draft.cardGap} range={CARD_GAP_RANGE} onChange={(v) => applyDraft({ ...draft, cardGap: v })} />
          <SliderRow id="row-gap" label="Spacing between rows" value={draft.rowGap} range={CARD_GAP_RANGE} onChange={(v) => applyDraft({ ...draft, rowGap: v })} />
        </Section>

        <CardAppearanceSection idPrefix="lib" draft={draft} onApply={applyCardPatch} onSaveNow={saveCardPatchNow} />
        <CardBorderSection idPrefix="lib" draft={draft} onApply={applyCardPatch} onSaveNow={saveCardPatchNow} />
        <CardContentSection idPrefix="lib" draft={draft} onApply={applyCardPatch} onSaveNow={saveCardPatchNow} />
        <CardTextSection idPrefix="lib" draft={draft} onApply={applyCardPatch} onSaveNow={saveCardPatchNow} />

        <Section title="Library canvas" wide>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm font-semibold" htmlFor="custom-bg-toggle">
                  <input
                    id="custom-bg-toggle"
                    type="checkbox"
                    checked={usingCustomBackground}
                    onChange={(e) => {
                      if (e.target.checked) {
                        // Prefill with the current theme background rather
                        // than some arbitrary default color, so turning
                        // this on isn't a jarring color jump to fix.
                        const computed = getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim();
                        saveNow({ ...draft, backgroundColor: computed || "#1a1815" });
                      } else {
                        saveNow({ ...draft, backgroundColor: null });
                      }
                    }}
                  />
                  Custom background color
                </label>
              </div>
              {usingCustomBackground && (
                <input
                  type="color"
                  value={draft.backgroundColor ?? "#1a1815"}
                  onChange={(e) => applyDraft({ ...draft, backgroundColor: e.target.value })}
                  className="mt-1 h-9 w-20 rounded border border-(--color-border) bg-transparent"
                />
              )}
            </div>
            <div />
            <SliderRow
              id="content-max-width"
              label="Content width"
              value={draft.contentMaxWidth}
              range={CONTENT_MAX_WIDTH_RANGE}
              onChange={(v) => applyDraft({ ...draft, contentMaxWidth: v })}
            />
            <div />
            <SliderRow
              id="content-padding-x"
              label="Padding around books (sides)"
              value={draft.contentPaddingX}
              range={CONTENT_PADDING_RANGE}
              onChange={(v) => applyDraft({ ...draft, contentPaddingX: v })}
            />
            <SliderRow
              id="content-padding-y"
              label="Padding around books (top/bottom)"
              value={draft.contentPaddingY}
              range={CONTENT_PADDING_RANGE}
              onChange={(v) => applyDraft({ ...draft, contentPaddingY: v })}
            />
          </div>
        </Section>
      </div>

      <button
        onClick={() => saveNow(DEFAULT_LIBRARY_STYLE)}
        className="mb-8 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm hover:bg-(--color-surface-hover)"
      >
        Reset all to defaults
      </button>

      <h3 className="mb-3 text-sm font-semibold text-(--color-text-dim)">
        Preview{!library?.data.books.length && " (sample books — your library is empty)"}
      </h3>
      {/* The real LibraryCanvas, not a hand-rolled imitation of it —
          this used to duplicate its background/width/padding math inline
          and would silently drift from the component the moment either
          changed. The dashed outline is the only thing added on top: it
          marks where the canvas ENDS, which is the whole point of this
          preview now that these settings stop at the books instead of
          washing over the entire page. With no custom background set the
          canvas is transparent, so without an outline there'd be nothing
          to see at all.

          `contentMaxWidth` is deliberately NOT applied here: it belongs
          to PageContainer (the page's own width, header included), not
          to the canvas, and this preview panel is far narrower than any
          value the slider offers — showing it here could only ever
          mislead. */}
      <div className="overflow-hidden rounded-xl border border-dashed border-(--color-border)">
        <LibraryCanvas style={draft}>
          <BookGrid style={draft}>
            {previewBooks.map((book, i) => (
              <BookCard key={String(book.ContentID ?? i)} book={book} onClick={() => {}} style={draft} />
            ))}
          </BookGrid>
        </LibraryCanvas>
      </div>
      <p className="mt-2 text-xs text-(--color-text-dim)">
        The dashed edge is where your canvas ends — the app's own menus, page header, and search bar sit outside it and
        keep the app's theme no matter what you set here. Content width isn't previewed: this panel is narrower than
        every value that slider offers. Hover a card above to see the shadow and hover animation settings.
      </p>
    </PageContainer>
  );
}
