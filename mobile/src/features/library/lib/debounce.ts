// Coalesces rapid-fire style edits (StepperRow taps held down, color
// swatch taps) into a single PUT /library — same reasoning and timing as
// frontend's LibraryStylePage.tsx/PerCardStylePanel.tsx's own 400ms
// `window.setTimeout` debounce, just wrapped as a reusable hook instead of
// each panel rolling its own timer ref. See Task 5A's "coalesce whole-
// document saves" requirement.

import { useEffect, useRef } from "react";

export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs = 400,
): { schedule: (...args: Args) => void; flush: () => void; cancel: () => void } {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingArgsRef = useRef<Args | null>(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    return () => {
      // Flush on unmount rather than dropping it — closing a style sheet
      // mid-drag shouldn't silently discard the last, most-intended value.
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        if (pendingArgsRef.current) callbackRef.current(...pendingArgsRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cancel() {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingArgsRef.current = null;
  }

  function schedule(...args: Args) {
    pendingArgsRef.current = args;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const pending = pendingArgsRef.current;
      pendingArgsRef.current = null;
      if (pending) callbackRef.current(...pending);
    }, delayMs);
  }

  function flush() {
    if (timerRef.current === null) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    const pending = pendingArgsRef.current;
    pendingArgsRef.current = null;
    if (pending) callbackRef.current(...pending);
  }

  return { schedule, flush, cancel };
}
