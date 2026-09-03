import { useEffect } from "react";

/** A bottom sheet for picking one value from a short list.
 *
 *  Exists because the Library toolbar's status/sort controls became icon
 *  buttons — an icon has nowhere to show the current value or the
 *  choices, so tapping one has to open something. A sheet rather than a
 *  dropdown: these are reached one-handed on a phone, and a sheet anchors
 *  its rows at the bottom of the screen within thumb reach instead of
 *  hanging off wherever the trigger happens to sit.
 *
 *  Deliberately mirrors BookDetailSheet's shell rather than introducing a
 *  second sheet idiom — same backdrop, same `items-end` on mobile /
 *  `items-center` on desktop, same rounded-top-on-mobile treatment, same
 *  click-outside and Escape handling. The two aren't factored into a
 *  shared primitive yet: that's two usages, and the right abstraction
 *  isn't obvious until something needs a third shape. What matters is
 *  that they don't LOOK like two different systems.
 *
 *  Not portaled, unlike OptionsMenu. That component portals because its
 *  trigger can sit inside a transformed, overflow-hidden mural block,
 *  which would both clip it and re-anchor its `fixed` positioning. This
 *  renders from the toolbar, which has neither problem, and a
 *  full-viewport `fixed` backdrop needs no positioning relative to its
 *  trigger at all. */
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
        // pb includes the safe-area inset so the last row clears a
        // gesture bar — this sheet's rows go all the way to the bottom
        // edge, unlike BookDetailSheet's scrolling body.
        className="w-full rounded-t-2xl border border-(--color-border) bg-(--color-surface) pb-[env(safe-area-inset-bottom,0px)] shadow-lg sm:max-w-sm sm:rounded-2xl sm:pb-0"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <p className="px-5 pt-4 pb-1 text-sm font-semibold text-(--color-text-dim)">{title}</p>
        <div className="p-2">
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                onClick={() => {
                  onSelect(option.value);
                  onClose();
                }}
                // aria-pressed rather than a plain button: the checkmark
                // is the only visual marker of the current value, and it
                // would otherwise be invisible to a screen reader.
                aria-pressed={selected}
                className={`flex min-h-12 w-full items-center justify-between rounded-lg px-3 text-left text-[15px] ${
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
        </div>
      </div>
    </div>
  );
}
