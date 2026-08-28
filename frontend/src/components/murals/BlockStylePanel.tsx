import { useRef, useState } from "react";
import { resolveBlockStyle, type BlockStyle } from "../../lib/libraryStyle";
import type { MuralBlock } from "../../lib/murals";
import { BlockAppearanceSection, BlockTextSection, CardBorderSection } from "../StyleControls";

/** "Style" button's modal (MuralCanvas.tsx, edit mode) — a mural block's
 *  own appearance: background color, corner radius, opacity, shadow,
 *  hover, border, and text (font, size, color). Separate control from the
 *  gear icon's content config (BlockConfigPanel.tsx), same Style-vs-Cover
 *  split BookCard.tsx already has for a book.
 *
 *  Unlike PerCardStylePanel.tsx there's no "Custom style" on/off toggle —
 *  a mural block has no priority chain above it to inherit from or
 *  override, so this edits `block.style` directly and always-on, same
 *  shape as LibraryStylePage.tsx (the top of that chain, which also has
 *  no "customize?" gate). Sliders debounce (`applyPatch`); everything
 *  else (checkboxes, the color pickers' own toggle) saves immediately
 *  (`savePatchNow`) — identical split to every other style panel here. */
export function BlockStylePanel({
  block,
  onSave,
  onClose
}: {
  block: MuralBlock;
  onSave: (style: BlockStyle) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<BlockStyle>(resolveBlockStyle(block.style));
  const saveTimerRef = useRef<number | undefined>(undefined);

  function applyPatch(patch: Partial<BlockStyle>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => onSave(next), 400);
  }

  function savePatchNow(patch: Partial<BlockStyle>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    window.clearTimeout(saveTimerRef.current);
    onSave(next);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-(--color-border) bg-(--color-surface) shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-(--color-border) p-4">
          <h3 className="text-sm font-semibold">Block style</h3>
          <button onClick={onClose} className="text-sm text-(--color-text-dim) hover:text-(--color-text)">
            Close
          </button>
        </div>

        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <BlockAppearanceSection idPrefix="mural-block" draft={draft} onApply={applyPatch} onSaveNow={savePatchNow} />
          <CardBorderSection idPrefix="mural-block" draft={draft} onApply={applyPatch} onSaveNow={savePatchNow} />
          <BlockTextSection idPrefix="mural-block" draft={draft} onApply={applyPatch} onSaveNow={savePatchNow} />
        </div>
      </div>
    </div>
  );
}
