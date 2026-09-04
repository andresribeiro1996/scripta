import { useEffect, useRef } from "react";

// Mirrors useScrollLock.ts's module-level counter for the same nesting
// problem (dialogs stack: a book's detail sheet opens the cover picker,
// which opens a confirm dialog) — a LIFO stack of close-callback refs instead
// of a count, since Escape and the edge-swipe gesture (EdgeSwipeBack.tsx)
// both need to close only the TOPMOST open dialog, not all of them at
// once.
//
// Stores ref objects (not raw callbacks) to ensure stack membership is stable
// across parent re-renders. If a parent re-renders and passes a new `onClose`
// reference (which happens when it's an inline function like `() => setOpen(false)`),
// the effect doesn't re-run, and the stack order doesn't change — only the ref's
// `.current` is updated. This prevents accidental reordering of the stack and
// avoids the edge case where two dialogs with the same callback reference would
// both be removed on a single unmount.
let stack: Array<{ current: () => void }> = [];

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
  // Hold the latest onClose in a ref, updated on every render but without
  // triggering the effect below — ref.current changes don't cause re-runs.
  const ref = useRef(onClose);
  // oxlint-disable-next-line react/refs
  ref.current = onClose;

  useEffect(() => {
    if (!enabled) return;
    stack.push(ref);
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && stack[stack.length - 1] === ref) ref.current();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      // Remove this specific ref object, not by callback identity — if two
      // dialogs ever happened to have the same callback reference, this still
      // only removes the one ref that belongs to this mount.
      stack = stack.filter((r) => r !== ref);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled]);
}

/** Closes the topmost registered dialog, if any — used by
 *  EdgeSwipeBack.tsx so a swipe closes one dialog at a time instead of
 *  falling through to page navigation while something's still open. */
export function dismissTopmost(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.current();
  return true;
}
