# Edge-swipe-to-go-back / close

## Problem

On mobile there's no built-in gesture to go back or dismiss the current
modal/sheet/drawer. Every overlay in the app (`Sheet`, `ConfirmDialog`,
`CoverPickerModal`, `ShareModal`, `MoveToFolderModal`, `BookDetailSheet`,
`OptionsMenu`'s dropdown, `DashboardLayout`'s mobile drawer) already owns
its own open/close state and its own duplicated Escape-key handler, with
no shared "what's currently open" registry. A left-to-right swipe from
the screen edge should close the topmost open overlay if one is open, or
navigate back a page if none is.

## Decisions

- **Swipe zone: edge-only.** Recognized only when the touch starts within
  24px of the left viewport edge — matches iOS's native back-gesture
  convention and avoids fighting the mural canvas's existing touch-drag
  interactions (block dragging, `draggableCancel`/`touchMode`), which
  happen mid-screen, not at the literal edge.
- **Stacked overlays: close only the topmost.** A confirm dialog opened
  from inside a share modal, for example, closes just the confirm dialog
  on one swipe, leaving the share modal open underneath. This must also
  fix a pre-existing bug in the same code path: today, pressing Escape
  with two overlays stacked closes *both* at once, because each mounted
  component has its own independent `keydown` listener. Escape and
  swipe both route through the same stack, so both become topmost-only.
- **No history to go back to → land on `/dashboard`.** Covers a deep
  link or PWA home-screen launch straight into a nested route, where
  `navigate(-1)` would otherwise do nothing or exit the app.
- **No visual drag-follow.** The swipe fires the action once it crosses
  a distance threshold; the current screen does not track the finger
  like iOS's native transition. Keeps this to a threshold-based gesture
  recognizer instead of a real-time transform/animation system.

## Architecture

Two new files, both under `frontend/src/`:

### `hooks/useDismissible.ts`

A module-level LIFO stack of close-callbacks, structurally the same
pattern `hooks/useScrollLock.ts` already uses for the identical nesting
problem (dialogs stack: a book's detail sheet opens the cover picker,
which opens a confirm dialog) — a plain module-level mutable array, no
Context/provider, so nothing changes in `main.tsx`.

```ts
let stack: Array<() => void> = [];

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

export function dismissTopmost(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top();
  return true;
}
```

Replaces the Escape-key `useEffect` duplicated today in `Sheet.tsx`,
`ConfirmDialog.tsx`, `BookDetailSheet.tsx`, and `DashboardLayout.tsx`'s
drawer. `CoverPickerModal.tsx`, `ShareModal.tsx`, `MoveToFolderModal.tsx`,
and `OptionsMenu.tsx`'s dropdown gain both swipe-dismiss and Escape
support for the first time by adopting the same hook.

### `components/EdgeSwipeBack.tsx`

Mounted once, inside `App.tsx` (already inside `BrowserRouter`, so
`useNavigate` is available). One `touchstart`/`touchmove`/`touchend`
listener on `window`:

- `touchstart`: record the start point; only arm the gesture if
  `startX <= 24`.
- `touchmove`: track latest point (no visual effect applied).
- `touchend` (armed only): compute `dx = endX - startX`,
  `dy = endY - startY`. If `dx >= 60 && Math.abs(dx) > 2 * Math.abs(dy)`,
  fire:
  - `dismissTopmost()` (from `useDismissible.ts`) — if it returns
    `true`, a modal was closed, stop here.
  - Otherwise: `history.state?.idx > 0 ? navigate(-1) : navigate("/dashboard")`.

## Call sites touched

One-line change each — call `useDismissible(onClose)` in place of (or
in addition to) the component's current close-handling:

- `components/Sheet.tsx`
- `components/ConfirmDialog.tsx`
- `components/CoverPickerModal.tsx`
- `components/ShareModal.tsx`
- `components/murals/MoveToFolderModal.tsx`
- `components/BookDetailSheet.tsx`
- `components/OptionsMenu.tsx` (dropdown)
- `layouts/DashboardLayout.tsx` (mobile drawer, `onClose = () => setDrawerOpen(false)`)

`App.tsx` gains one line mounting `<EdgeSwipeBack />`.

## Not touched

The mural canvas's own drag/pan/reorder touch interactions — edge-only
recognition (touch must start within 24px of the screen edge) means
normal canvas dragging, which doesn't start at the literal edge, is
unaffected.

## Testing

No touch-simulation test harness exists in this repo (no
Playwright/Cypress config). Verification is:

- `npm run typecheck` / `npm run lint` in `frontend/` after the change.
- Manual check on an actual phone (per the `run` skill) — swipe closes
  a modal, closes the mobile drawer, and navigates back on a plain page;
  confirms stacked-modal swipe closes only the top one.
- Optionally, a plain unit test around `useDismissible`'s push/pop stack
  logic itself, since that part is pure and doesn't need real touch
  events.
