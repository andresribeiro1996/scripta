import { useState } from "react";
import { useDismissible } from "../../hooks/useDismissible";
import { Sheet } from "../Sheet";
import { BUTTON_SECONDARY } from "../page/buttonClasses";
import { PlusIcon, toolbarIconClass } from "../Toolbar";
import { blockLabel, type BlockType } from "../../lib/murals";
import { useLocale, useT, type WebMessages } from "../../i18n";

// Label comes from blockLabel (lib/murals.ts, over the shared block table) —
// which the history log's "X block added" entries also draw from — so a type's
// display name only ever needs changing in one place. Only `description` is
// local, since nothing else needs it.
const BLOCK_CHOICES: Array<{ type: BlockType; description: Extract<keyof WebMessages, `muralEditor.addDesc${string}`> }> = [
  { type: "spotlight", description: "muralEditor.addDescSpotlight" },
  { type: "shelf", description: "muralEditor.addDescShelf" },
  { type: "quote", description: "muralEditor.addDescQuote" },
  { type: "quoteCollection", description: "muralEditor.addDescQuoteCollection" },
  { type: "image", description: "muralEditor.addDescImage" },
  { type: "text", description: "muralEditor.addDescText" },
  { type: "profile", description: "muralEditor.addDescProfile" },
  { type: "currentlyReading", description: "muralEditor.addDescCurrentlyReading" },
  { type: "stats", description: "muralEditor.addDescStats" },
  { type: "empty", description: "muralEditor.addDescEmpty" },
  { type: "tierlist", description: "muralEditor.addDescTierlist" }
];

/** The "+" that opens the 10 block types. Clicking one adds it to the
 *  canvas (lib/murals.ts's addBlock, placed below everything already
 *  there) and immediately opens its config panel, except for the types
 *  with nothing to configure right away (Currently Reading and Empty
 *  have no config at all; Stats does, but starts with a sensible
 *  default selection already applied).
 *
 *  Two presentations of one `open` state, split at `sm` the same way
 *  every list page's toolbar is: below `sm` a 44px icon whose choices
 *  open in a bottom sheet (the trigger sits in the page's top corner —
 *  the furthest point from a thumb — and the rows carry the
 *  descriptions that make the ten choices self-explanatory), at `sm`
 *  and up the dropdown anchored to the button that has always been
 *  there. CSS picks which one shows; neither state is ever shared
 *  across the split. */
export function AddBlockMenu({ onAdd }: { onAdd: (type: BlockType) => void }) {
  const locale = useLocale();
  const t = useT();
  const [open, setOpen] = useState(false);
  // Only covers the desktop dropdown branch below — the mobile Sheet
  // branch already registers its own dismissible via Sheet itself. Both
  // branches render whenever `open` is true (split only by CSS
  // breakpoint), so this harmlessly double-registers on mobile widths
  // too; that's a duplicate stack entry, not a bug.
  useDismissible(() => setOpen(false), open);

  function pick(type: BlockType) {
    onAdd(type);
    setOpen(false);
  }

  return (
    <>
      <button onClick={() => setOpen(true)} aria-label={t("muralEditor.addBlock")} title={t("muralEditor.addBlock")} className={`${toolbarIconClass()} sm:hidden`}>
        <PlusIcon />
      </button>
      <div className="relative hidden sm:block">
        <button
          onClick={() => setOpen((o) => !o)}
          className={BUTTON_SECONDARY}
        >
          {t("muralEditor.addBlockButton")}
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute top-full right-0 z-50 mt-1 w-72 rounded-xl border border-(--color-border) bg-(--color-surface) p-1.5 shadow-lg">
              {BLOCK_CHOICES.map((choice) => (
                <button
                  key={choice.type}
                  onClick={() => pick(choice.type)}
                  className="block w-full rounded-lg px-3 py-2 text-left hover:bg-(--color-surface-hover)"
                >
                  <div className="text-sm font-semibold">{blockLabel(choice.type, locale)}</div>
                  <div className="text-xs text-(--color-text-dim)">{t(choice.description)}</div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {open && (
        <div className="sm:hidden">
          <Sheet title={t("muralEditor.addBlock")} onClose={() => setOpen(false)}>
            {BLOCK_CHOICES.map((choice) => (
              <button
                key={choice.type}
                onClick={() => pick(choice.type)}
                className="flex min-h-12 w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left hover:bg-(--color-surface-hover)"
              >
                <span className="text-[15px] font-semibold">{blockLabel(choice.type, locale)}</span>
                <span className="text-xs text-(--color-text-dim)">{t(choice.description)}</span>
              </button>
            ))}
          </Sheet>
        </div>
      )}
    </>
  );
}
