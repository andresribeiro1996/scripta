import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDismissible } from "../hooks/useDismissible";

export interface OptionsMenuItem {
  label: string;
  onClick: () => void;
  /** Renders this item in --color-danger, same red every destructive
   *  action in the app already uses (ConfirmDialog's own confirm button,
   *  GroupsPage's "Delete" text link). */
  danger?: boolean;
}

const MENU_WIDTH = 132;

// A plain hub-and-spokes gear, not a Unicode "⚙" glyph — the glyph was the
// actual bug report this exists to fix: "⚙" doesn't sit centered within
// its own character cell in most fonts (font-dependent side bearing, not
// a CSS bug), so even a correctly flex-centered button visibly looked
// off-center. An SVG drawn on a 24×24 viewBox centered at (12,12) is
// centered by construction — same reasoning BookCard.tsx's own inline
// BookIcon/checkmark SVGs already follow for exactly this reason.
function GearIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1M18.5 18.5l-2.1-2.1M7.6 7.6 5.5 5.5" />
    </svg>
  );
}

/** A single ⚙ trigger that opens a small dropdown of actions — the one
 *  consolidated entry point for "this item's controls," replacing what
 *  used to be several separate always-visible buttons wherever it's used
 *  (mural blocks' old 🎨/⚙/× row in MuralCanvas.tsx; a mural list card's
 *  old "Rename"/"Delete" text buttons in MuralsListPage.tsx) — same shape
 *  BookCard's Style/Cover buttons and GroupsPage's per-series
 *  Delete/"Manage books" controls already keep compact, just one step
 *  further consolidated behind one trigger instead of several.
 *
 *  The dropdown is portaled to document.body, not rendered inline where
 *  the trigger lives — required, not a style choice, whenever the trigger
 *  sits inside an ancestor with `overflow: hidden` and/or its own CSS
 *  `transform` (a react-grid-layout mural block is both at once): a
 *  transformed ancestor becomes the *containing block* for any
 *  `position: fixed` descendant, which quietly turns "relative to the
 *  viewport" into "relative to that ancestor" — so the menu would still
 *  get clipped by the very overflow-hidden it was trying to escape.
 *  Portaling out of the DOM subtree sidesteps both. Position is computed
 *  once, from the trigger button's own `getBoundingClientRect()` at click
 *  time; the menu closes on Escape, a click outside itself, or picking
 *  any item. */
export function OptionsMenu({
  items,
  title = "Settings",
  triggerClassName = "flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(10,8,6,0.72)] text-white backdrop-blur-xs"
}: {
  items: OptionsMenuItem[];
  title?: string;
  /** Full className for the trigger button. Callers own the visual
   *  treatment — a dark translucent circle for a trigger sitting on
   *  arbitrary block content/imagery (needs contrast regardless of
   *  what's underneath), a plain ghost icon for one sitting on a flat
   *  card background — only the gear glyph inside is fixed. */
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useDismissible(() => setOpen(false), open);

  function toggle(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setPosition({ top: rect.bottom + 4, left: rect.right - MENU_WIDTH });
    setOpen((o) => !o);
  }

  return (
    <>
      <button onClick={toggle} title={title} className={triggerClassName}>
        <GearIcon />
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            style={{ top: position.top, left: position.left, width: MENU_WIDTH }}
            className="fixed z-50 overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface) py-1 text-sm shadow-lg"
          >
            {items.map((item) => (
              <button
                key={item.label}
                onClick={(e) => {
                  e.stopPropagation();
                  item.onClick();
                  setOpen(false);
                }}
                className={`block w-full px-3 py-1.5 text-left ${
                  item.danger ? "text-(--color-danger) hover:bg-(--color-danger-soft)" : "hover:bg-(--color-surface-hover)"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
