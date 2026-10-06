import { flushSync } from "react-dom";

/** Applies a React state update wrapped in the View Transitions API when
 *  the browser supports it, so a drag-to-reorder visibly animates cards
 *  sliding to their new slots instead of just popping there (see
 *  BookCard.tsx's `viewTransitionName`). `flushSync` is required because
 *  the API needs the DOM to have actually re-rendered by the time its
 *  callback returns — a plain state update wouldn't commit until React's
 *  next scheduled render, too late for the transition to see it. Falls
 *  back to a plain (instant, unanimated) update on any browser that
 *  doesn't support it — this is a nice-to-have, never required. */
export function updateWithViewTransition(applyUpdate: () => void) {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> };
  };
  if (typeof doc.startViewTransition !== "function") {
    applyUpdate();
    return;
  }
  try {
    const transition = doc.startViewTransition(() => flushSync(applyUpdate));
    // The state update above already committed via flushSync regardless
    // of what happens to the animation itself — these two promises are
    // purely about the *animation's* outcome, not the data. `ready`
    // rejects (InvalidStateError) whenever the browser skips the
    // transition outright — a hidden document, or another transition
    // still in flight — which is routine, not a real failure, so both
    // need a no-op `.catch` or it surfaces as an unhandled rejection.
    transition.ready.catch(() => {});
    transition.finished.catch(() => {});
  } catch {
    applyUpdate();
  }
}

export function saveWithViewTransition<T>(start: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    updateWithViewTransition(() => {
      start().then(resolve, reject);
    });
  });
}
