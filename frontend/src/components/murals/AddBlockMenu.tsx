import { useState } from "react";
import { Sheet } from "../Sheet";
import { PlusIcon, toolbarIconClass } from "../Toolbar";
import { BLOCK_TYPE_LABELS, type BlockType } from "../../lib/murals";

// Label comes from BLOCK_TYPE_LABELS (lib/murals.ts) — the same map the
// history log's "X block added" entries draw from — so a type's display
// name only ever needs changing in one place. Only `description` is
// local, since nothing else needs it.
const BLOCK_CHOICES: Array<{ type: BlockType; description: string }> = [
  { type: "spotlight", description: "One book, big cover, optional caption" },
  { type: "shelf", description: "A titled, ordered row of books you pick" },
  { type: "quote", description: "One featured highlight, shown large" },
  { type: "quoteCollection", description: "Several curated highlights together" },
  { type: "image", description: "A photo from your gallery" },
  { type: "text", description: "A heading or freeform note" },
  { type: "currentlyReading", description: "Auto-updates from your reading status" },
  { type: "stats", description: "Auto-computed numbers, e.g. books finished this year" },
  { type: "empty", description: "A plain styled block — no content, just background/border/etc." },
  { type: "tierlist", description: "Rank books into S/A/B/C… rows — tiers are yours to configure" }
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
  const [open, setOpen] = useState(false);

  function pick(type: BlockType) {
    onAdd(type);
    setOpen(false);
  }

  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Add a block" title="Add a block" className={`${toolbarIconClass()} sm:hidden`}>
        <PlusIcon />
      </button>
      <div className="relative hidden sm:block">
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-lg bg-(--color-accent) px-3 py-2 text-sm font-semibold text-white"
        >
          + Add block
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
                  <div className="text-sm font-semibold">{BLOCK_TYPE_LABELS[choice.type]}</div>
                  <div className="text-xs text-(--color-text-dim)">{choice.description}</div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {open && (
        <div className="sm:hidden">
          <Sheet title="Add a block" onClose={() => setOpen(false)}>
            {BLOCK_CHOICES.map((choice) => (
              <button
                key={choice.type}
                onClick={() => pick(choice.type)}
                className="flex min-h-12 w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left hover:bg-(--color-surface-hover)"
              >
                <span className="text-[15px] font-semibold">{BLOCK_TYPE_LABELS[choice.type]}</span>
                <span className="text-xs text-(--color-text-dim)">{choice.description}</span>
              </button>
            ))}
          </Sheet>
        </div>
      )}
    </>
  );
}
