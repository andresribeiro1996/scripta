# Edge-swipe-to-go-back / close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A left-to-right swipe starting at the left screen edge closes the topmost open modal/sheet/drawer, or navigates back a page if nothing's open.

**Architecture:** A module-level LIFO stack of close-callbacks (`useDismissible.ts`, mirroring `useScrollLock.ts`'s existing nesting pattern) that every modal/sheet/drawer registers into, plus one global touch-gesture listener (`EdgeSwipeBack.tsx`, mounted once in `App.tsx`) that pops the stack or calls `react-router-dom`'s `navigate`.

**Tech Stack:** React 19, TypeScript, react-router-dom v7 (`BrowserRouter`), native Touch Events (no gesture library).

**Spec:** `docs/superpowers/specs/2026-09-04-edge-swipe-back-design.md`

## Global Constraints

- Edge-only recognition: touch must start within 24px of the left viewport edge.
- Swipe must move ≥60px right and be more horizontal than vertical (`dx > 2·|dy|`), so an edge-started vertical scroll isn't hijacked.
- Stacked overlays: swipe (and, after this plan, Escape) closes only the topmost registered dialog — never all of them at once.
- No history to go back to → `navigate("/dashboard")` instead of a no-op `navigate(-1)`.
- No live drag-follow animation — the action fires once past the threshold.
- `frontend/` has no test runner configured (no vitest/jest, no `test` script in `package.json`) — verification for every task is `npm run typecheck` and `npm run lint` (oxlint) from `frontend/`, plus a final manual on-device check. Do not add a test framework to satisfy this plan.
- Match each touched file's existing comment density and JSDoc-block style (see `hooks/useScrollLock.ts` for the closest precedent) — this is shared infra other code depends on, not a one-off.

---

### Task 1: `useDismissible` stack hook

**Files:**
- Create: `frontend/src/hooks/useDismissible.ts`

**Interfaces:**
- Produces: `useDismissible(onClose: () => void, enabled?: boolean): void` — call from any modal/sheet/drawer in place of its own Escape-key `useEffect`. `enabled` defaults to `true`; pass `false` while closed for always-mounted providers (mirrors `useScrollLock`'s own `enabled` param).
- Produces: `dismissTopmost(): boolean` — closes the topmost registered dialog if one exists, returns whether it found one. Consumed by Task 2's `EdgeSwipeBack`.

- [ ] **Step 1: Write the hook**

```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `cd frontend && npm run lint`
Expected: no new warnings/errors on the new file.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useDismissible.ts
git commit -m "feat(frontend): add useDismissible dialog stack hook"
```

---

### Task 2: `EdgeSwipeBack` gesture listener, mounted in `App.tsx`

**Files:**
- Create: `frontend/src/components/EdgeSwipeBack.tsx`
- Modify: `frontend/src/App.tsx:1,25-27`

**Interfaces:**
- Consumes: `dismissTopmost()` from `frontend/src/hooks/useDismissible.ts` (Task 1).
- Produces: `EdgeSwipeBack` component (named export, renders `null`), mounted once in `App.tsx`.

- [ ] **Step 1: Write the component**

```tsx
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
      armed = e.touches.length === 1 && touch.clientX <= EDGE_ZONE_PX;
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
```

- [ ] **Step 2: Mount it in `App.tsx`**

Current relevant lines:

```tsx
import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "./auth/RequireAuth";
```

and:

```tsx
export function App() {
  return (
    <Routes>
```
...
```tsx
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
```

Change to:

```tsx
import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "./auth/RequireAuth";
import { EdgeSwipeBack } from "./components/EdgeSwipeBack";
```

and:

```tsx
export function App() {
  return (
    <>
      <EdgeSwipeBack />
      <Routes>
```
...
```tsx
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
```

(Keep the rest of the `<Routes>` tree exactly as-is — only wrap it in a
fragment with `<EdgeSwipeBack />` as a sibling, and re-indent the
`<Routes>...</Routes>` block one level in.)

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Lint**

Run: `cd frontend && npm run lint`
Expected: no new warnings/errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/EdgeSwipeBack.tsx frontend/src/App.tsx
git commit -m "feat(frontend): add edge-swipe-back gesture listener"
```

---

### Task 3: Migrate `Sheet.tsx`

**Files:**
- Modify: `frontend/src/components/Sheet.tsx:1-32`

**Interfaces:**
- Consumes: `useDismissible` from Task 1.

- [ ] **Step 1: Swap the Escape effect for `useDismissible`**

Old:

```tsx
import { type ReactNode, useEffect } from "react";
import type { OptionsMenuItem } from "./OptionsMenu";
import { useScrollLock } from "../hooks/useScrollLock";
```
...
```tsx
export function Sheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useScrollLock();
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
```

New:

```tsx
import { type ReactNode } from "react";
import type { OptionsMenuItem } from "./OptionsMenu";
import { useDismissible } from "../hooks/useDismissible";
import { useScrollLock } from "../hooks/useScrollLock";
```
...
```tsx
export function Sheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useScrollLock();
  useDismissible(onClose);
```

(`useEffect` is unused elsewhere in this file, so drop it from the import entirely.)

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors (confirms `useEffect` removal didn't leave a dangling reference).

- [ ] **Step 3: Lint**

Run: `cd frontend && npm run lint`
Expected: no new warnings/errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Sheet.tsx
git commit -m "refactor(frontend): Sheet closes via useDismissible"
```

---

### Task 4: Migrate `ConfirmDialog.tsx`

**Files:**
- Modify: `frontend/src/components/ConfirmDialog.tsx:1-2,61-69`

**Interfaces:**
- Consumes: `useDismissible` from Task 1.

- [ ] **Step 1: Swap the Escape effect for `useDismissible`**

Old:

```tsx
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useScrollLock } from "../hooks/useScrollLock";
```
...
```tsx
  useEffect(() => {
    if (!pending) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") settle(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);
```

New:

```tsx
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useDismissible } from "../hooks/useDismissible";
import { useScrollLock } from "../hooks/useScrollLock";
```
...
```tsx
  useDismissible(() => settle(false), pending !== null);
```

(`useEffect` stays imported — the cancel-button-focus effect right above still uses it.)

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `cd frontend && npm run lint`
Expected: no new warnings/errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ConfirmDialog.tsx
git commit -m "refactor(frontend): ConfirmDialog closes via useDismissible"
```

---

### Task 5: Migrate `BookDetailSheet.tsx`

**Files:**
- Modify: `frontend/src/components/BookDetailSheet.tsx:1-27`

**Interfaces:**
- Consumes: `useDismissible` from Task 1.

- [ ] **Step 1: Swap the Escape effect for `useDismissible`**

Old:

```tsx
import { useEffect } from "react";
import { CoverImage } from "./BookCard";
import { statusLabel } from "../lib/covers";
import { nextReadStatus } from "../lib/libraryView";
import { useScrollLock } from "../hooks/useScrollLock";
```
...
```tsx
  useScrollLock();
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
```

New:

```tsx
import { CoverImage } from "./BookCard";
import { statusLabel } from "../lib/covers";
import { nextReadStatus } from "../lib/libraryView";
import { useDismissible } from "../hooks/useDismissible";
import { useScrollLock } from "../hooks/useScrollLock";
```
...
```tsx
  useScrollLock();
  useDismissible(onClose);
```

(`useEffect` isn't used anywhere else in this file — drop the import line entirely.)

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `cd frontend && npm run lint`
Expected: no new warnings/errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/BookDetailSheet.tsx
git commit -m "refactor(frontend): BookDetailSheet closes via useDismissible"
```

---

### Task 6: Migrate `CoverPickerModal.tsx`

**Files:**
- Modify: `frontend/src/components/CoverPickerModal.tsx:1-6,39-40`

**Interfaces:**
- Consumes: `useDismissible` from Task 1.

- [ ] **Step 1: Add `useDismissible`**

This modal had no Escape handling before — it gains both Escape and edge-swipe dismissal for the first time.

Old:

```tsx
import { useRef, useState } from "react";
import type { GalleryImage } from "../api/gallery";
import { useDeleteGalleryImage } from "../hooks/useDeleteGalleryImage";
import { useGalleryImages } from "../hooks/useGalleryImages";
import { useConfirm } from "./ConfirmDialog";
import { useScrollLock } from "../hooks/useScrollLock";
```
...
```tsx
  useScrollLock();
  const { images, isLoading, upload } = useGalleryImages();
```

New:

```tsx
import { useRef, useState } from "react";
import type { GalleryImage } from "../api/gallery";
import { useDeleteGalleryImage } from "../hooks/useDeleteGalleryImage";
import { useDismissible } from "../hooks/useDismissible";
import { useGalleryImages } from "../hooks/useGalleryImages";
import { useConfirm } from "./ConfirmDialog";
import { useScrollLock } from "../hooks/useScrollLock";
```
...
```tsx
  useScrollLock();
  useDismissible(onClose);
  const { images, isLoading, upload } = useGalleryImages();
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `cd frontend && npm run lint`
Expected: no new warnings/errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/CoverPickerModal.tsx
git commit -m "feat(frontend): CoverPickerModal closes via useDismissible"
```

---

### Task 7: Migrate `ShareModal.tsx`

**Files:**
- Modify: `frontend/src/components/ShareModal.tsx:1-6,76-82`

**Interfaces:**
- Consumes: `useDismissible` from Task 1.

- [ ] **Step 1: Swap the Escape effect for `useDismissible`**

Old:

```tsx
import { useEffect, useRef, useState } from "react";
import { ApiError, postToSocial, type SocialProvider } from "../api/socials";
import { useSocials } from "../hooks/useSocials";
import { useConfirm } from "./ConfirmDialog";
import { SocialIcon } from "./icons/SocialIcons";
import { useScrollLock } from "../hooks/useScrollLock";
```
...
```tsx
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);
```

New:

```tsx
import { useEffect, useRef, useState } from "react";
import { ApiError, postToSocial, type SocialProvider } from "../api/socials";
import { useDismissible } from "../hooks/useDismissible";
import { useSocials } from "../hooks/useSocials";
import { useConfirm } from "./ConfirmDialog";
import { SocialIcon } from "./icons/SocialIcons";
import { useScrollLock } from "../hooks/useScrollLock";
```
...
```tsx
  useDismissible(onClose);
```

(`useEffect` stays imported — the copied-timeout cleanup effect right above it still uses it.)

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `cd frontend && npm run lint`
Expected: no new warnings/errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ShareModal.tsx
git commit -m "refactor(frontend): ShareModal closes via useDismissible"
```

---

### Task 8: Migrate `MoveToFolderModal.tsx`

**Files:**
- Modify: `frontend/src/components/murals/MoveToFolderModal.tsx:1-18`

**Interfaces:**
- Consumes: `useDismissible` from Task 1.

- [ ] **Step 1: Add `useDismissible`**

This modal had no Escape handling before — it gains both Escape and edge-swipe dismissal for the first time.

Old:

```tsx
import { buildTree } from "../../lib/muralFolders";
import type { MuralFolder } from "../../lib/murals";
import { useScrollLock } from "../../hooks/useScrollLock";

export function MoveToFolderModal({
  title,
  folders,
  disabledIds,
  onSelect,
  onClose
}: {
  title: string;
  folders: MuralFolder[];
  disabledIds: Set<string>;
  onSelect: (folderId: string | null) => void;
  onClose: () => void;
}) {
  useScrollLock();
```

New:

```tsx
import { buildTree } from "../../lib/muralFolders";
import type { MuralFolder } from "../../lib/murals";
import { useDismissible } from "../../hooks/useDismissible";
import { useScrollLock } from "../../hooks/useScrollLock";

export function MoveToFolderModal({
  title,
  folders,
  disabledIds,
  onSelect,
  onClose
}: {
  title: string;
  folders: MuralFolder[];
  disabledIds: Set<string>;
  onSelect: (folderId: string | null) => void;
  onClose: () => void;
}) {
  useScrollLock();
  useDismissible(onClose);
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `cd frontend && npm run lint`
Expected: no new warnings/errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/murals/MoveToFolderModal.tsx
git commit -m "feat(frontend): MoveToFolderModal closes via useDismissible"
```

---

### Task 9: Migrate `OptionsMenu.tsx` dropdown

**Files:**
- Modify: `frontend/src/components/OptionsMenu.tsx:1-2,70-84`

**Interfaces:**
- Consumes: `useDismissible` from Task 1.

- [ ] **Step 1: Split Escape handling out of the outside-click effect**

Old:

```tsx
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
```
...
```tsx
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);
```

New:

```tsx
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDismissible } from "../hooks/useDismissible";
```
...
```tsx
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useDismissible(() => setOpen(false), open);
```

(Outside-click-to-close stays exactly as it was — only Escape moves to the shared stack, and the dropdown now also registers as a dismissible while open, so edge-swipe closes it too.)

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `cd frontend && npm run lint`
Expected: no new warnings/errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/OptionsMenu.tsx
git commit -m "refactor(frontend): OptionsMenu dropdown closes via useDismissible"
```

---

### Task 10: Migrate `DashboardLayout.tsx` mobile drawer

**Files:**
- Modify: `frontend/src/layouts/DashboardLayout.tsx:1,58-65`

**Interfaces:**
- Consumes: `useDismissible` from Task 1.

- [ ] **Step 1: Swap the Escape effect for `useDismissible`**

Old:

```tsx
import { Fragment, useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { OfflineBanner } from "../components/OfflineBanner";
import { useScrollLock } from "../hooks/useScrollLock";
```
...
```tsx
  useEffect(() => {
    if (!drawerOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen]);
```

New:

```tsx
import { Fragment, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { OfflineBanner } from "../components/OfflineBanner";
import { useDismissible } from "../hooks/useDismissible";
import { useScrollLock } from "../hooks/useScrollLock";
```
...
```tsx
  useDismissible(() => setDrawerOpen(false), drawerOpen);
```

(`useEffect` is unused elsewhere in this file — drop it from the import.)

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `cd frontend && npm run lint`
Expected: no new warnings/errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/layouts/DashboardLayout.tsx
git commit -m "refactor(frontend): dashboard drawer closes via useDismissible"
```

---

### Task 11: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + lint pass**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 2: On-device check (per the `run` skill)**

Build/serve the app on a phone (or phone-width browser devtools with touch emulation) and verify, for each:

- Plain page (e.g. `/dashboard/series` reached by tapping a bottom-nav tab from Library) → edge-swipe right navigates back to Library.
- Deep-linked page with no in-app history (open a URL like `/dashboard/settings` fresh in a new tab) → edge-swipe navigates to `/dashboard` (not a no-op, not app exit).
- A single modal open (e.g. Cover picker from a book card) → edge-swipe closes just the picker, back to the book grid.
- Two stacked (e.g. open Share on a mural, then trigger "Stop sharing" to bring up the confirm dialog on top) → edge-swipe closes only the confirm dialog, Share modal still open; a second edge-swipe then closes Share.
- Mobile "More" drawer (DashboardLayout) → edge-swipe closes it.
- Mural editor canvas → dragging a block from the middle of the screen still works and does not trigger a back-navigation (edge-only zone is the safeguard here).

- [ ] **Step 3: Commit if anything needed fixing**

```bash
git add -A
git commit -m "fix(frontend): edge-swipe-back on-device fixes"
```

(Skip this step if step 2 needed no changes.)
