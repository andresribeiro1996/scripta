import { useEffect } from "react";

// Mirrors useScrollLock.ts's module-level counter for the same nesting
// problem (dialogs stack: a book's detail sheet opens the cover picker,
// which opens a confirm dialog) — a LIFO stack of close-callbacks instead
// of a count, since Escape and the edge-swipe gesture (EdgeSwipeBack.tsx)
// both need to close only the TOPMOST open dialog, not all of them at
// once.
let stack: Array<() => void> = [];

/** Registers `onClose` as the topmost dismissible for as long as this
 *  component is mounted with `enabled` true (the `enabled` param exists
 *  for always-mounted providers like ConfirmProvider that render their
 *  dialog conditionally — same convention useScrollLock uses).
 *
 *  Replaces each dialog's own Escape-key `useEffect`: before this, every
 *  mounted dialog had its own independent `keydown` listener, so Escape
 *  with two stacked (e.g. a confirm dialog opened from inside a share
 *  modal) closed both at once. Now only the top of the stack responds. */
export function useDismissible(onClose: () => void, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    stack.push(onClose);
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && stack[stack.length - 1] === onClose) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      stack = stack.filter((fn) => fn !== onClose);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, enabled]);
}

/** Closes the topmost registered dialog, if any — used by
 *  EdgeSwipeBack.tsx so a swipe closes one dialog at a time instead of
 *  falling through to page navigation while something's still open. */
export function dismissTopmost(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top();
  return true;
}
