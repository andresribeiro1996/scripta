import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useDismissible } from "../hooks/useDismissible";
import { MoreIcon } from "./NavIcons";

export interface OptionsMenuItem {
  label: string;
  onClick: () => void;
  /** Renders this item in --color-danger, same red every destructive
   *  action in the app already uses (ConfirmDialog's own confirm button,
   *  GroupsPage's "Delete" text link). */
  danger?: boolean;
  checked?: boolean;
}

const MENU_WIDTH = 132;
const ROW_HEIGHT = 44;
const EDGE_GAP = 8;

/** A single three-dot trigger that opens a small dropdown of actions — the one
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
  triggerClassName,
  trigger
}: {
  items: OptionsMenuItem[];
  title?: string;
  /** Full className for the trigger button. Callers own the visual
   *  treatment — a dark translucent circle for a trigger sitting on
   *  arbitrary block content/imagery (needs contrast regardless of
   *  what's underneath), a plain ghost icon for one sitting on a flat
   *  card background — only the three-dot glyph inside is fixed. */
  triggerClassName?: string;
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top?: number; bottom?: number; left: number; maxHeight: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector("button")?.focus();
    function handlePointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) && !triggerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useDismissible(close, open);

  function toggle(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const left = Math.max(8, rect.width > MENU_WIDTH ? rect.left : rect.right - MENU_WIDTH);
    const wanted = items.length * ROW_HEIGHT + 10;
    const below = window.innerHeight - rect.bottom - EDGE_GAP - 4;
    const above = rect.top - EDGE_GAP - 4;
    if (wanted <= below || below >= above) setPosition({ top: rect.bottom + 4, left, maxHeight: below });
    else setPosition({ bottom: window.innerHeight - rect.top + 4, left, maxHeight: above });
    setOpen((o) => !o);
  }

  return (
    <>
      <button ref={triggerRef} type="button" onClick={toggle} title={title} aria-label={title} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} className={triggerClassName ?? "flex h-11 w-11 items-center justify-center"}>
        {trigger ??
          (triggerClassName ? (
            <MoreIcon size={16} />
          ) : (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgba(10,8,6,0.72)] text-white backdrop-blur-xs">
              <MoreIcon size={16} />
            </span>
          ))}
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={title}
            onKeyDown={(event) => {
              if (event.key === "Tab") {
                close();
                return;
              }
              const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
              const current = buttons.findIndex((button) => button === document.activeElement);
              let next: number;
              if (event.key === "ArrowDown") next = (current + 1) % buttons.length;
              else if (event.key === "ArrowUp") next = (current - 1 + buttons.length) % buttons.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = buttons.length - 1;
              else return;
              event.preventDefault();
              buttons[next]?.focus();
            }}
            style={{ top: position.top, bottom: position.bottom, left: position.left, minWidth: MENU_WIDTH, maxHeight: position.maxHeight }}
            className="menu-in fixed z-50 overflow-y-auto rounded-lg border border-(--color-border) bg-(--color-surface) py-1 text-sm shadow-lg"
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                aria-checked={item.checked}
                onClick={(e) => {
                  e.stopPropagation();
                  close();
                  if (!item.checked) item.onClick();
                }}
                className={`flex w-full items-center justify-between gap-3 min-h-11 px-3 text-left ${
                  item.danger ? "text-(--color-danger) hover:bg-(--color-danger-soft)" : "hover:bg-(--color-surface-hover)"
                }`}
              >
                {item.label}
                {item.checked ? <span aria-hidden="true">✓</span> : null}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
