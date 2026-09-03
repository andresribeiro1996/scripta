import { type ReactNode, useEffect } from "react";
import type { OptionsMenuItem } from "./OptionsMenu";

/** The shared shell behind every bottom sheet: backdrop, Escape and
 *  click-outside dismissal, and the bottom-anchored-on-mobile /
 *  centered-on-desktop positioning.
 *
 *  Factored out at the third usage, not the second. OptionSheet arrived
 *  alone and copied BookDetailSheet's shell deliberately — with two
 *  usages the right seam wasn't obvious. ActionSheet below made three,
 *  and by then the shell was the same three times over, so it moved
 *  here. BookDetailSheet deliberately still has its own: it needs a
 *  scrolling body with a max height and a header row with a Close
 *  button, and bending this to cover that would make it a worse fit for
 *  both. What matters is that they don't LOOK like different systems.
 *
 *  Not portaled, unlike OptionsMenu. That component portals because its
 *  trigger can sit inside a transformed, overflow-hidden mural block,
 *  which would both clip it and silently re-anchor its `fixed`
 *  positioning to that ancestor. A sheet is a full-viewport `fixed`
 *  backdrop that needs no positioning relative to its trigger at all, so
 *  neither problem applies. */
function Sheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        // The bottom padding carries the safe-area inset: a sheet's rows
        // run to the very bottom edge (unlike BookDetailSheet's
        // scrolling body), so without it the last row sits under a
        // gesture bar.
        className="w-full rounded-t-2xl border border-(--color-border) bg-(--color-surface) pb-[env(safe-area-inset-bottom,0px)] shadow-lg sm:max-w-sm sm:rounded-2xl sm:pb-0"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <p className="px-5 pt-4 pb-1 text-sm font-semibold text-(--color-text-dim)">{title}</p>
        <div className="p-2">{children}</div>
      </div>
    </div>
  );
}

const ROW_CLASS = "flex min-h-12 w-full items-center justify-between rounded-lg px-3 text-left text-[15px]";

/** Picks one value from a short list.
 *
 *  Exists because the Library toolbar's status/sort controls became icon
 *  buttons — an icon has nowhere to show its current value or the
 *  choices, so tapping one has to open something. A sheet rather than a
 *  dropdown: these are reached one-handed on a phone, and a sheet
 *  anchors its rows at the bottom of the screen within thumb reach
 *  instead of hanging off wherever the trigger happens to sit. */
export function OptionSheet<T extends string>({
  title,
  options,
  value,
  onSelect,
  onClose
}: {
  title: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onSelect: (value: T) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            onClick={() => {
              onSelect(option.value);
              onClose();
            }}
            // aria-pressed rather than a plain button: the checkmark is
            // the only visual marker of the current value, and it would
            // otherwise be invisible to a screen reader.
            aria-pressed={selected}
            className={`${ROW_CLASS} ${
              selected ? "bg-(--color-accent-soft) font-semibold text-(--color-accent)" : "hover:bg-(--color-surface-hover)"
            }`}
          >
            {option.label}
            {selected && (
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            )}
          </button>
        );
      })}
    </Sheet>
  );
}

/** Runs one action from a short list — the sheet counterpart to
 *  OptionsMenu's dropdown.
 *
 *  Takes OptionsMenu's own item type rather than declaring a parallel
 *  one, so a caller can move between the two presentations without
 *  reshaping its items. Used for the Library page's actions on phones,
 *  where a dropdown hanging off a toolbar icon in the top-right corner
 *  is both the furthest point from a thumb and inconsistent with the
 *  filter and sort controls sitting immediately beside it. OptionsMenu's
 *  dropdown is still the right thing where it's used on desktop-sized
 *  targets (mural blocks, series rows). */
export function ActionSheet({ title, items, onClose }: { title: string; items: OptionsMenuItem[]; onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose}>
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => {
            item.onClick();
            onClose();
          }}
          className={`${ROW_CLASS} ${item.danger ? "text-(--color-danger) hover:bg-(--color-danger-soft)" : "hover:bg-(--color-surface-hover)"}`}
        >
          {item.label}
        </button>
      ))}
    </Sheet>
  );
}
