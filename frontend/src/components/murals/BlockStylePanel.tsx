import { useRef, useState, type ReactNode } from "react";
import {
  CARD_RADIUS_RANGE,
  resolveBlockStyle,
  type BlockStyle,
} from "../../lib/libraryStyle";
import type { MuralBlock } from "../../lib/murals";
import {
  BlockBackgroundSection,
  BlockEffectsSection,
  BlockTextSection,
  CardBorderSection,
  SliderRow,
} from "../StyleControls";
import { Sheet } from "../Sheet";
import { SavedLooks } from "./SavedLooks";

export function BlockStylePanel({
  block,
  onSave,
  onClose,
  preview,
}: {
  block: MuralBlock;
  onSave: (style: BlockStyle) => void;
  onClose: () => void;
  preview: (style: BlockStyle) => ReactNode;
}) {
  const [draft, setDraft] = useState<BlockStyle>(
    resolveBlockStyle(block.style),
  );
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
    <Sheet title="Block style" onClose={onClose} style={{ maxWidth: "42rem" }}>
      <div
        aria-hidden="true"
        inert
        className="pointer-events-none sticky top-0 z-10 max-h-40 overflow-hidden border-b border-(--color-border) bg-(--color-surface) p-3"
      >
        {preview(draft)}
      </div>
      <div className="space-y-2 p-2">
        <StyleGroup title="Background" initiallyOpen>
          <BlockBackgroundSection
            idPrefix="mural-block"
            draft={draft}
            onApply={applyPatch}
            onSaveNow={savePatchNow}
          />
        </StyleGroup>
        <StyleGroup title="Text">
          <BlockTextSection
            idPrefix="mural-block"
            draft={draft}
            onApply={applyPatch}
            onSaveNow={savePatchNow}
          />
        </StyleGroup>
        <StyleGroup title="Border">
          <SliderRow
            id="mural-block-block-radius"
            label="Corner radius"
            value={draft.cardRadius}
            range={CARD_RADIUS_RANGE}
            onChange={(cardRadius) => applyPatch({ cardRadius })}
          />
          <CardBorderSection
            idPrefix="mural-block"
            draft={draft}
            onApply={applyPatch}
            onSaveNow={savePatchNow}
          />
        </StyleGroup>
        <StyleGroup title="Effects">
          <BlockEffectsSection
            idPrefix="mural-block"
            draft={draft}
            onApply={applyPatch}
            onSaveNow={savePatchNow}
          />
        </StyleGroup>
        <StyleGroup title="Looks">
          <SavedLooks style={draft} onApply={(style) => savePatchNow(style)} />
        </StyleGroup>
      </div>
    </Sheet>
  );
}

function StyleGroup({
  title,
  initiallyOpen = false,
  children,
}: {
  title: string;
  initiallyOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      name="mural-block-style"
      open={initiallyOpen}
      className="rounded-xl border border-(--color-border)"
    >
      <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold">
        {title}
      </summary>
      <div className="p-4 pt-0 [&>section]:border-0 [&>section]:p-0 [&>section>h4]:hidden">
        {children}
      </div>
    </details>
  );
}
