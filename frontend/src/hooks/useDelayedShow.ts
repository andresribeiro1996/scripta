import { useEffect, useState } from "react";

/** True only once `active` has held for `delayMs`.
 *
 *  Guards loading skeletons against the flicker that makes them worse
 *  than the plain "Loading…" they replace: against a warm cache or a LAN
 *  API most loads resolve in well under 100ms, and a skeleton that
 *  appears and vanishes inside one frame budget reads as a glitch rather
 *  than as progress. Below the threshold nothing is drawn at all, which
 *  is what a fast load should look like.
 *
 *  Resets the moment `active` goes false, so a quick load never leaves a
 *  skeleton on screen after its content has arrived. */
export function useDelayedShow(active: boolean, delayMs = 160): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setShown(true), delayMs);
    // Reset in cleanup rather than in an `if (!active)` branch: cleanup
    // already runs exactly when `active` goes false, and setting state
    // synchronously in the effect body starts a second render for
    // something the cleanup handles for free.
    return () => {
      window.clearTimeout(timer);
      setShown(false);
    };
  }, [active, delayMs]);

  return shown;
}
