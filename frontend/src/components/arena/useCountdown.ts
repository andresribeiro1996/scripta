import { useEffect, useState } from "react";
import { countdownLabel } from "@scripta/shared";

/** Live "time left" label for a duel's `closesAt`, ticking once a second.
 *
 *  Extracted from DuelCard when the bracket's own match sheet needed the
 *  same thing: an active match that looks identical whether it closes in
 *  eight hours or forty seconds is missing the one fact that decides
 *  whether you vote now. Shared rather than duplicated so the two views
 *  can never disagree about how long is left.
 *
 *  Returns "Closing…" rather than a negative once the deadline passes —
 *  the duel is settled by the server's own sweep, not by this timer, so
 *  there's a real window where a client sees a closed duel that hasn't
 *  been swept yet. */
export function useCountdown(closesAt: string): string {
  const [label, setLabel] = useState("");
  useEffect(() => {
    function tick() {
      setLabel(countdownLabel(closesAt));
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [closesAt]);
  return label;
}
