import { useEffect } from "react";

// How many locks are currently held. Module-level rather than per-hook
// because dialogs stack: a book's detail sheet opens the cover picker,
// which opens a confirm dialog. Each unmounts separately, and without a
// count the FIRST one to close would unlock the page while two are still
// open. Only the last release restores the page.
let lockCount = 0;
// Captured when the first lock is taken, so the restore puts back
// whatever was actually there rather than assuming the default.
let savedOverflow = "";
let savedPaddingRight = "";

/** Freezes the page behind a modal for as long as the calling component
 *  is mounted.
 *
 *  Without this, dragging anywhere over an open dialog scrolls the
 *  LIBRARY behind it — the dialog appears stuck while the page slides
 *  around underneath, and closing it leaves you somewhere you never
 *  meant to scroll to. A dialog that has nothing to scroll is the worst
 *  case: every gesture goes straight through to the page.
 *
 *  Pairs with `overscroll-contain` on a dialog's own scrollable element.
 *  The two solve different halves and both are needed: this stops the
 *  page moving at all, while `overscroll-contain` stops a scroll that
 *  STARTED inside a scrollable dialog from chaining onward to the page
 *  once it hits the end of its content.
 *
 *  Body `overflow: hidden` reflows the page when the scrollbar
 *  disappears, so the scrollbar's width is added back as padding —
 *  otherwise opening a dialog visibly shifts the whole page sideways on
 *  desktop. The measurement is 0 on phones and on any overlay-scrollbar
 *  platform, which is the common case here.
 *
 *  Known limitation: iOS Safari does not fully honour `overflow: hidden`
 *  on the body, and the complete fix there (`position: fixed` on the
 *  body plus manual scroll-position save and restore) brings its own
 *  problems — it fights the keyboard, and any mis-restore silently
 *  teleports the reader. Not worth it until someone reports it on an
 *  actual iPhone; Android Chrome and desktop, which is what this app is
 *  used on today, are handled correctly.
 *
 *  `enabled` exists for the providers that are ALWAYS mounted and render
 *  their dialog conditionally (ConfirmProvider, SeedSlotGrid). Calling
 *  this unconditionally there would lock the page for the lifetime of
 *  the app — it would simply never scroll again — so they pass whether
 *  their dialog is currently open. Components that mount only while open
 *  take the default. */
export function useScrollLock(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    if (lockCount === 0) {
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      savedOverflow = document.body.style.overflow;
      savedPaddingRight = document.body.style.paddingRight;
      document.body.style.overflow = "hidden";
      if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        document.body.style.overflow = savedOverflow;
        document.body.style.paddingRight = savedPaddingRight;
      }
    };
  }, [enabled]);
}
