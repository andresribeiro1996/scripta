# Phase 3 — Feedback & Safety (Toasts, Undo Delete, Surfaced Failures) Implementation Plan

**Goal:** A minimal toast system; destructive deletes (books, groups) become confirm-free with a 6-second undo window instead; every background save failure surfaces as an error toast instead of a console.error or silent rollback.

**Architecture:** One new context provider (`ToastProvider` + `useToast`) mounted in `main.tsx`, rendering a stack of self-expiring toasts (optional action button, used by Undo) pinned above the mobile tab bar / bottom-right on desktop. Undo works by snapshotting the pre-delete `LibraryData` and, on undo, saving the snapshot back through the normal save path. The mural-scrub that accompanies book deletes (`scrubBooks`) is **deferred** until the undo window lapses (6.5s timer, cleared by undo) so an undo never leaves murals scrubbed. Confirm dialogs are dropped only where undo replaces them (book bulk-delete, group delete); `ConfirmDialog` stays for gallery/mural deletions.

**Tech Stack:** React 19 + Vite + TS, Tailwind v4. No new dependencies, no backend changes, no new pure-logic modules (the undo flow is save-snapshot-back — nothing to unit-test; verification is mechanical + manual).

**Spec:** `docs/superpowers/plans/2026-08-31-ux-enhancements-roadmap.md` (Phase 3). Findings addressed: D5 (silent failures), D6 (confirm-only safety net).

## Global Constraints

- `npm run typecheck` and `npm run lint` (from `frontend/`) after every task; no new warnings.
- No comments in code.
- All existing `scripts/test-*.mts` suites must stay green, unmodified.
- Accepted trade (do not engineer around): an undo restores the snapshot wholesale — any OTHER edit that lands between delete and undo (within 6s) is overwritten by the restore. Personal app, tiny window; documented here.
- Toast duration default 5000ms; undo toasts 6000ms with the scrub timer at 6500ms (margin so the undo click always wins the race).

---

### Task 1: Toast system

**Files:**
- Create: `frontend/src/components/Toaster.tsx`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Produces: `useToast(): (options: ToastOptions) => void` and `ToastProvider`, where `ToastOptions = { message: string; kind?: "info" | "error"; action?: { label: string; onClick: () => void }; duration?: number }`. Tasks 2–3 import `useToast` from `../components/Toaster`.

- [ ] **Step 1: Create `frontend/src/components/Toaster.tsx` with EXACTLY:**

```tsx
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

export interface ToastOptions {
  message: string;
  kind?: "info" | "error";
  action?: { label: string; onClick: () => void };
  duration?: number;
}

interface ToastItem {
  id: number;
  message: string;
  kind: "info" | "error";
  action?: { label: string; onClick: () => void };
}

const ToastContext = createContext<((options: ToastOptions) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message: options.message, kind: options.kind ?? "info", action: options.action }]);
      window.setTimeout(() => dismiss(id), options.duration ?? 5000);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2 lg:bottom-4">
        {toasts.map((t) => {
          const action = t.action;
          return (
            <div
              key={t.id}
              role={t.kind === "error" ? "alert" : "status"}
              className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${
                t.kind === "error"
                  ? "border-(--color-danger-soft) bg-(--color-danger-soft) text-(--color-danger)"
                  : "border-(--color-border) bg-(--color-surface) text-(--color-text)"
              }`}
            >
              <span className="flex-1">{t.message}</span>
              {action && (
                <button
                  onClick={() => {
                    action.onClick();
                    dismiss(t.id);
                  }}
                  className="font-semibold text-(--color-accent) hover:opacity-80"
                >
                  {action.label}
                </button>
              )}
              <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-(--color-text-dim) hover:text-(--color-text)">
                ×
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (options: ToastOptions) => void {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
```

(Position note: `bottom-[calc(4.5rem+…)]` keeps toasts clear of the mobile bottom tab bar below `lg`; `lg:bottom-4` is the standard desktop position. `z-[60]` sits above modals' `z-50` so failures raised from inside a modal are still visible.)

- [ ] **Step 2: Mount in `frontend/src/main.tsx`**

Add the import and wrap OUTSIDE `ConfirmProvider` (so any component below either provider can toast):

```tsx
<AuthProvider>
  <ToastProvider>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </ToastProvider>
</AuthProvider>
```

- [ ] **Step 3: Verify**

`npm run typecheck && npm run lint` from `frontend/` — pass, no new warnings. (Visual check happens with Tasks 2–3.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Toaster.tsx frontend/src/main.tsx
git commit -m "feat(frontend): toast system with optional undo action"
```

### Task 2: LibraryPage — undo delete + surfaced failures

**Files:**
- Modify: `frontend/src/pages/LibraryPage.tsx`

**Interfaces:**
- Consumes: `useToast` (Task 1); existing `saveLibrary`/`queryClient`/`scrubBooks` pieces.

- [ ] **Step 1: Wire the hook and drop the now-unused confirm**

Add `const toast = useToast();` next to the existing hooks, import `useToast` from `../components/Toaster`, and REMOVE the `useConfirm` import and its `const confirm = useConfirm();` line — this page's only confirm usage was the delete flow being replaced (leaving it unused fails lint).

- [ ] **Step 2: Replace `handleDeleteSelected` with the undo flow**

Replace the whole function with exactly:

```tsx
async function handleDeleteSelected() {
  if (selectedKeys.size === 0) return;
  const current = queryClient.getQueryData<LibraryDocument>(["library"]);
  if (!current) return;
  const keys = selectedKeys;
  try {
    const saved = await saveLibrary({
      ...current.data,
      books: current.data.books.filter((b) => !keys.has(bookKey(b))),
      groups: removeBooksFromAllGroups(current.data.groups ?? [], keys)
    });
    queryClient.setQueryData(["library"], saved);
  } catch {
    toast({ message: "Couldn't delete — nothing was changed.", kind: "error" });
    return;
  }
  setSelectedKeys(new Set());
  setSelectionMode(false);
  const scrubTimer = setTimeout(() => void scrubBooks(keys), 6500);
  toast({
    message: `Deleted ${keys.size} book${keys.size === 1 ? "" : "s"}.`,
    action: {
      label: "Undo",
      onClick: () => {
        clearTimeout(scrubTimer);
        void (async () => {
          try {
            const restored = await saveLibrary(current.data);
            queryClient.setQueryData(["library"], restored);
            toast({ message: "Restored." });
          } catch {
            toast({ message: "Couldn't restore — check your connection.", kind: "error" });
          }
        })();
      }
    },
    duration: 6000
  });
}
```

(The mural scrub is deferred 6.5s — longer than the toast — so undoing within the window cancels it entirely; mural blocks never lose their books for an undone delete.)

- [ ] **Step 3: Surface failure toasts on the other async handlers**

Add `try/catch` around each listed handler's `await saveLibrary(...)` (leave success paths and cache writes exactly as they are — a throw must skip the `setQueryData`, which the current ordering already guarantees):

- `handleRenameLibrary` → catch: `toast({ message: "Couldn't save the new name.", kind: "error" })`
- `handleSaveBookStyle` → `"Couldn't save the style change."`
- `handleSaveBookCover` → `"Couldn't save the cover change."`
- `handleRemoveBookCover` → `"Couldn't save the cover change."`
- `handleSetBookStatus` → `"Couldn't save the status change."`
- `handleReorder`'s background save `.catch(...)` → keep the rollback, add `toast({ message: "Couldn't save the new order — moved back.", kind: "error" })` alongside the existing `console.error` line.

Do NOT touch `handleFileChosen` (import errors already render inline).

- [ ] **Step 4: Verify mechanically**

`npm run typecheck && npm run lint` from `frontend/` — pass, no new warnings. `npx tsx scripts/test-library-order.mts` and `npx tsx scripts/test-library-view.mts` still pass.

- [ ] **Step 5: Verify manually (desktop + 390×844)**

1. Select 2 books → "Delete selected" → NO confirm dialog; toast "Deleted 2 books." with Undo appears bottom-right (desktop) / above the tab bar (mobile); grid updates immediately.
2. Click Undo within 6s → both books return (incl. series membership); "Restored." toast; wait 8s and reload → books still there.
3. Repeat a delete, DON'T undo, wait ~7s (backend log shows the mural scrub call), reload → books gone.
4. Kill the backend → drag a card → rollback now shows an error toast; change a book status → error toast.
5. Toasts dismiss via ×; several stack without overlap.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/LibraryPage.tsx
git commit -m "feat(frontend): undo for book deletion and toasts on save failures"
```

### Task 3: GroupsPage — undo deletes + surfaced failures

**Files:**
- Modify: `frontend/src/pages/GroupsPage.tsx`

**Interfaces:**
- Consumes: `useToast` (Task 1); existing `useLibrary().updateLibrary`, `useMurals().scrubBooks`.

- [ ] **Step 1: Wire the hook, drop confirm**

`const toast = useToast();` + import; remove the `useConfirm` import and `const confirm = useConfirm();` — both its usages (group delete, bulk book delete) are being replaced.

- [ ] **Step 2: Replace `handleDelete` (group delete) with undo**

```tsx
async function handleDelete(group: Group) {
  const snapshot = library?.data;
  if (!snapshot) return;
  try {
    await updateLibrary((data) => ({ ...data, groups: deleteGroup(data.groups ?? [], group.id) }));
  } catch {
    toast({ message: "Couldn't delete — nothing was changed.", kind: "error" });
    return;
  }
  toast({
    message: `Deleted "${group.name}".`,
    action: {
      label: "Undo",
      onClick: () => {
        void (async () => {
          try {
            await updateLibrary(() => snapshot);
            toast({ message: "Restored." });
          } catch {
            toast({ message: "Couldn't restore — check your connection.", kind: "error" });
          }
        })();
      }
    },
    duration: 6000
  });
}
```

(No mural scrub involved in a group delete — groups don't live in murals.)

- [ ] **Step 3: Replace `handleDeleteSelected` (bulk book delete) with the deferred-scrub undo flow**

```tsx
async function handleDeleteSelected() {
  if (selectedKeys.size === 0) return;
  const snapshot = library?.data;
  if (!snapshot) return;
  const keys = selectedKeys;
  try {
    await updateLibrary((data) => ({
      ...data,
      books: data.books.filter((b) => !keys.has(bookKey(b))),
      groups: removeBooksFromAllGroups(data.groups ?? [], keys)
    }));
  } catch {
    toast({ message: "Couldn't delete — nothing was changed.", kind: "error" });
    return;
  }
  setSelectedKeys(new Set());
  setSelectionMode(false);
  const scrubTimer = setTimeout(() => void scrubBooks(keys), 6500);
  toast({
    message: `Deleted ${keys.size} book${keys.size === 1 ? "" : "s"}.`,
    action: {
      label: "Undo",
      onClick: () => {
        clearTimeout(scrubTimer);
        void (async () => {
          try {
            await updateLibrary(() => snapshot);
            toast({ message: "Restored." });
          } catch {
            toast({ message: "Couldn't restore — check your connection.", kind: "error" });
          }
        })();
      }
    },
    duration: 6000
  });
}
```

(The delete path's existing comment about murals being scrubbed via a separate call stays accurate — the call still happens, just after the undo window. Keep it; keep every other comment.)

- [ ] **Step 4: Failure toasts on remaining handlers**

Wrap each of: `handleCreate` (it has `try/finally` — add a `catch` before the `finally`), `handleRename`, `handleToggleBook`, `handleSaveGroupStyle`, `handleSaveBookStyle`, `handleSaveBookCover`, `handleRemoveBookCover` with:

```tsx
} catch {
  toast({ message: "Couldn't save — check your connection.", kind: "error" });
}
```

(one shared message — these are all small settings-shaped writes; the specific-message treatment stays a LibraryPage nicety.)

- [ ] **Step 5: Verify mechanically**

`npm run typecheck && npm run lint` — pass, no new warnings.

- [ ] **Step 6: Verify manually**

On `/dashboard/series`: OptionsMenu → Delete on a series → no dialog, toast with Undo; undo restores the series with its members and custom-style badge intact. On `/dashboard/collections`: select-delete books → same undo behavior as LibraryPage (incl. no dialog). Kill backend → create/rename a collection → error toast. Group "Manage books" picker still works.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/GroupsPage.tsx
git commit -m "feat(frontend): undo for group and book deletion on groups pages"
```

---

## Phase 3 exit criteria

- No confirm dialog on any book/group delete; every one is undoable for 6s and the undo fully restores (books + group memberships; murals never scrubbed when undone).
- Every background-save failure (reorder rollback, style/cover/status/name saves, deletes) shows an error toast; nothing fails silently.
- Toasts: stack, auto-dismiss, manual dismiss, visible above modals and clear of the mobile tab bar; error toasts announce as `alert` role.
- `typecheck`, `lint`, all suites pass.

## Self-review

- Coverage vs. Phase 3 spec: toast system → Task 1; undo delete with snapshot restore → Tasks 2–3; deferred mural scrub (the roadmap's "undo restores via the normal save path", made actually correct) → Tasks 2–3 Step 2/3; silent failures (reorder rollback + saves) → Task 2 Step 3, Task 3 Step 4; debounce indicators deliberately stay passive per spec.
- Placeholder scan: all code blocks complete; the only pattern-level instruction (Task 2 Step 3's per-handler catch list) enumerates every handler and its exact message.
- Type consistency: `ToastOptions`/`useToast` names match across Tasks 1–3; `updateLibrary(() => snapshot)` matches `useLibrary`'s `(current: LibraryData) => LibraryData` updater signature; `scrubBooks(keys)` unchanged.
- Scope guard: `ConfirmDialog` untouched and still used by gallery/CoverPicker flows; `handleFileChosen` untouched (inline banner already correct).
