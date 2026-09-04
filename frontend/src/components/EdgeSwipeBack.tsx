import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { dismissTopmost } from "../hooks/useDismissible";

const EDGE_ZONE_PX = 24;
const MIN_SWIPE_PX = 60;

/** App-wide "swipe right from the left edge" gesture: closes whatever
 *  dialog/drawer is topmost (see useDismissible.ts), or navigates back a
 *  page if nothing's open. Edge-only, matching iOS's own back gesture,
 *  specifically so it doesn't compete with the mural canvas's own
 *  mid-screen touch-drag interactions (block dragging,
 *  MuralCanvas.tsx's `draggableCancel`/`touchMode`).
 *
 *  No live drag-follow — the action fires once the gesture crosses the
 *  distance threshold below, rather than tracking the finger like a
 *  native page transition. Computed from touchstart + touchend alone
 *  (no touchmove tracking needed) since there's nothing to render mid-
 *  gesture.
 *
 *  Mounted once in App.tsx, inside <BrowserRouter> (see main.tsx), so
 *  useNavigate is available here. Renders nothing itself. */
export function EdgeSwipeBack() {
  const navigate = useNavigate();

  useEffect(() => {
    let armed = false;
    let startX = 0;
    let startY = 0;

    function handleTouchStart(e: TouchEvent) {
      const touch = e.touches[0];
      // The mural canvas's own touch-mode viewport (`.mural-touch`,
      // MuralCanvas.tsx) can extend into the edge zone at mobile widths
      // and owns its own pan/drag interactions there — don't arm this
      // gesture over it, or panning near the edge would misfire as a
      // back-navigation.
      const insideMuralCanvas = (e.target as Element).closest?.(".mural-touch") !== null;
      armed = e.touches.length === 1 && touch.clientX <= EDGE_ZONE_PX && !insideMuralCanvas;
      startX = touch.clientX;
      startY = touch.clientY;
    }

    function handleTouchEnd(e: TouchEvent) {
      if (!armed) return;
      armed = false;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (dx < MIN_SWIPE_PX || dx <= 2 * Math.abs(dy)) return;

      if (dismissTopmost()) return;
      // react-router's BrowserRouter (see history package it wraps)
      // tracks position in `window.history.state.idx` — 0 means this is
      // the first entry in the app's own history, e.g. a deep link or a
      // PWA launched straight into a nested route, where navigate(-1)
      // would leave the app or no-op instead of going anywhere useful.
      const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
      if (idx > 0) navigate(-1);
      else navigate("/dashboard");
    }

    window.addEventListener("touchstart", handleTouchStart);
    window.addEventListener("touchend", handleTouchEnd);
    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [navigate]);

  return null;
}
