import { useRef, useState } from "react";
import { extractPerCardStyle, resolvePerCardStyle, type LibraryStyleSettings, type PerCardStyle } from "../lib/libraryStyle";
import { CardAppearanceSection, CardBorderSection, CardContentSection, CardTextSection } from "./StyleControls";
import { useScrollLock } from "../hooks/useScrollLock";

/** Generic "override the per-card style for one thing" modal — used both
 *  for a series (GroupsPage.tsx's "Style" button, series only) and a
 *  single book (BookCard.tsx's "Style" button, everywhere a card
 *  renders). Same UI, same behavior; the two differ only in what they're
 *  scoped to and what they take priority over — see `idPrefix` (keeps
 *  element ids unique if a series panel and a book panel could ever be
 *  open at once — they can't today, but costs nothing), `name`/`priorityText`
 *  (the header copy), and `currentOverride`/`seedStyle` (what's already
 *  saved, and what to seed from when turning customization on).
 *
 *  Editing here only ever touches the per-card-overridable subset of
 *  settings (`PerCardStyle` — see lib/libraryStyle.ts): once turned on,
 *  the target's cards render with this INSTEAD of whatever they'd
 *  otherwise resolve to for every field in that subset, while layout
 *  (card size/spacing) and page settings (which can't meaningfully vary
 *  per card/series within one shared grid — see lib/libraryStyle.ts's own
 *  comment) keep coming from further up the priority chain regardless. */
export function PerCardStylePanel({
  idPrefix,
  name,
  priorityText,
  currentOverride,
  seedStyle,
  onSave,
  onClose
}: {
  idPrefix: string;
  /** What's being styled, for the header — a series name or a book title. */
  name: string;
  /** What this override takes priority over, e.g. "the library-wide" or
   *  "the series and library-wide". */
  priorityText: string;
  currentOverride: PerCardStyle | undefined;
  /** What to seed the draft from when turning customization on — the
   *  currently-effective style one level up the priority chain, so
   *  enabling this never causes a jarring visual jump. */
  seedStyle: LibraryStyleSettings;
  onSave: (style: PerCardStyle | undefined) => void;
  onClose: () => void;
}) {
  useScrollLock();
  const [customized, setCustomized] = useState(currentOverride !== undefined);
  // Seeded from the current saved override if there is one (resolved
  // against defaults — see resolvePerCardStyle's own comment for why a
  // saved override can't always be trusted to be complete), otherwise
  // from `seedStyle` — so turning customization on starts from "looks the
  // same as it does now," not some arbitrary reset.
  const [draft, setDraft] = useState<PerCardStyle>(currentOverride ? resolvePerCardStyle(currentOverride) : extractPerCardStyle(seedStyle));
  const saveTimerRef = useRef<number | undefined>(undefined);

  function applyDraft(next: PerCardStyle) {
    setDraft(next);
    if (!customized) return; // nothing to persist until customization is actually on
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => onSave(next), 400);
  }

  function saveNow(next: PerCardStyle) {
    setDraft(next);
    window.clearTimeout(saveTimerRef.current);
    if (customized) onSave(next);
  }

  // The shared per-card sections (Card appearance/border/content — see
  // StyleControls.tsx) call back with just a partial patch, same as
  // LibraryStylePage.tsx's applyCardPatch/saveCardPatchNow — these merge
  // it into the full draft before handing off to applyDraft/saveNow above.
  function applyPatch(patch: Partial<PerCardStyle>) {
    applyDraft({ ...draft, ...patch });
  }
  function savePatchNow(patch: Partial<PerCardStyle>) {
    saveNow({ ...draft, ...patch });
  }

  function handleToggleCustomized(checked: boolean) {
    setCustomized(checked);
    window.clearTimeout(saveTimerRef.current);
    onSave(checked ? draft : undefined);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-xl border border-(--color-border) bg-(--color-surface) shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-(--color-border) p-4">
          <div>
            <h3 className="text-sm font-semibold">Style for "{name}"</h3>
            <p className="text-xs text-(--color-text-dim)">Takes priority over {priorityText} style.</p>
          </div>
          <button onClick={onClose} className="text-sm text-(--color-text-dim) hover:text-(--color-text)">
            Close
          </button>
        </div>

        <div className="p-4">
          <label className="mb-4 flex items-center gap-2 text-sm font-semibold" htmlFor={`${idPrefix}-style-customized`}>
            <input
              id={`${idPrefix}-style-customized`}
              type="checkbox"
              checked={customized}
              onChange={(e) => handleToggleCustomized(e.target.checked)}
            />
            Custom style
          </label>

          {!customized ? (
            <p className="text-sm text-(--color-text-dim)">Currently uses {priorityText} style. Turn this on to override it.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <CardAppearanceSection idPrefix={idPrefix} draft={draft} onApply={applyPatch} onSaveNow={savePatchNow} />
              <CardBorderSection idPrefix={idPrefix} draft={draft} onApply={applyPatch} onSaveNow={savePatchNow} />
              <CardContentSection idPrefix={idPrefix} draft={draft} onApply={applyPatch} onSaveNow={savePatchNow} />
              <CardTextSection idPrefix={idPrefix} draft={draft} onApply={applyPatch} onSaveNow={savePatchNow} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
