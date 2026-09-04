import { useEffect, useState } from "react";

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
      const remainingMs = new Date(closesAt).getTime() - Date.now();
      if (remainingMs <= 0) {
        setLabel("Closing…");
        return;
      }
      const totalSeconds = Math.floor(remainingMs / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      setLabel(hours > 0 ? `${hours}h ${minutes}m left` : minutes > 0 ? `${minutes}m ${seconds}s left` : `${seconds}s left`);
    }
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [closesAt]);
  return label;
}
