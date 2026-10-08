import { useEffect, useState } from "react";
import type { ReaderCardBase } from "@scripta/shared";
import { useDismissible } from "../../hooks/useDismissible";
import { useScrollLock } from "../../hooks/useScrollLock";
import { keepTabInside } from "../../lib/keepTabInside";
import { ReaderCardTurner } from "./ReaderCardTurner";

const CARD_WIDTH = "w-[min(88vw,calc((100dvh-10rem)*5/7))]";
const SPREAD_WIDTH = "w-[min(92vw,calc((100dvh-10rem)*10/7))]";
const PILL = "h-11 rounded-full bg-(--color-surface) px-4 text-(--color-text)";

export function ReaderCardViewer({ input, onClose, onEdit }: { input: ReaderCardBase; onClose: () => void; onEdit?: () => void }) {
  useScrollLock();
  useDismissible(onClose);
  const [previous] = useState(() => (typeof document === "undefined" ? null : document.activeElement));
  useEffect(() => () => {
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
  }, [previous]);

  return (
    <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Reader card" className="flex flex-col items-center gap-3" onClick={(event) => event.stopPropagation()} onKeyDown={keepTabInside}>
        <div className="flex gap-2 self-end">
          {onEdit && input.view === "owner" ? <button type="button" onClick={onEdit} className={PILL}>Edit card</button> : null}
          <button type="button" onClick={onClose} className={PILL}>Close</button>
        </div>
        <ReaderCardTurner input={input} cardWidth={CARD_WIDTH} spreadWidth={SPREAD_WIDTH} onScrim autoFocus />
      </div>
    </div>
  );
}
