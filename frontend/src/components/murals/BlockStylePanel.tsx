import { useRef, useState, type ReactNode } from "react";
import { CARD_RADIUS_RANGE, resolveBlockStyle, type BlockStyle } from "../../lib/libraryStyle";
import type { MuralBlock } from "../../lib/murals";
import { BlockBackgroundSection, BlockEffectsSection, BlockTextSection, CardBorderSection, SliderRow } from "../StyleControls";
import { useDismissible } from "../../hooks/useDismissible";
import { useScrollLock } from "../../hooks/useScrollLock";
import { SavedLooks } from "./SavedLooks";

export function BlockStylePanel({
  block,
  onSave,
  onClose,
  preview
}: {
  block: MuralBlock;
  onSave: (style: BlockStyle) => void;
  onClose: () => void;
  preview: (style: BlockStyle) => ReactNode;
}) {
  useScrollLock();
  useDismissible(onClose);
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
    <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-(--color-border) bg-(--color-surface) shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-(--color-border) p-4">
          <h3 className="text-sm font-semibold">Block style</h3>
          <button onClick={onClose} className="text-sm text-(--color-text-dim) hover:text-(--color-text)">
            Close
          </button>
        </div>

        <div aria-hidden="true" inert className="pointer-events-none max-h-40 shrink-0 overflow-hidden border-b border-(--color-border) p-3">
          {preview(draft)}
        </div>
        <div className="space-y-2 overflow-y-auto overscroll-contain p-4">
          <StyleGroup title="Background" initiallyOpen>
            <BlockBackgroundSection idPrefix="mural-block" draft={draft} onApply={applyPatch} onSaveNow={savePatchNow} />
          </StyleGroup>
          <StyleGroup title="Text">
            <BlockTextSection idPrefix="mural-block" draft={draft} onApply={applyPatch} onSaveNow={savePatchNow} />
          </StyleGroup>
          <StyleGroup title="Border">
            <SliderRow id="mural-block-block-radius" label="Corner radius" value={draft.cardRadius} range={CARD_RADIUS_RANGE} onChange={(cardRadius) => applyPatch({ cardRadius })} />
            <CardBorderSection idPrefix="mural-block" draft={draft} onApply={applyPatch} onSaveNow={savePatchNow} />
          </StyleGroup>
          <StyleGroup title="Effects">
            <BlockEffectsSection idPrefix="mural-block" draft={draft} onApply={applyPatch} onSaveNow={savePatchNow} />
          </StyleGroup>
          <StyleGroup title="Looks">
            <SavedLooks style={draft} onApply={(style) => savePatchNow(style)} />
          </StyleGroup>
        </div>
      </div>
    </div>
  );
}

function StyleGroup({ title, initiallyOpen = false, children }: { title: string; initiallyOpen?: boolean; children: ReactNode }) {
  return <details name="mural-block-style" open={initiallyOpen} className="rounded-xl border border-(--color-border)">
    <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold">{title}</summary>
    <div className="p-4 pt-0 [&>section]:border-0 [&>section]:p-0 [&>section>h4]:hidden">{children}</div>
  </details>;
}
