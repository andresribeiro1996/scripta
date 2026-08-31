# Phase 0 — Mobile Shell & Input Fundamentals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app usable on a phone: no horizontal overflow, reachable navigation (bottom tabs + More drawer), safe-area-correct standalone PWA, no iOS focus zoom, comfortable touch targets. Desktop visually unchanged at ≥1024px.

**Architecture:** All changes are in the existing frontend shell (`DashboardLayout.tsx`) and global CSS. Below `lg` (1024px) the sidebar is replaced by a fixed bottom tab bar (Library / Series / Collections / More) plus a left slide-over drawer opened by "More" carrying the full nav + account + logout. The book grid gets a CSS `min()` clamp so `cardMinWidth` can never exceed available width. No backend changes, no new dependencies, no behavior changes to data flows.

**Tech Stack:** React 19 + Vite + TypeScript, Tailwind CSS v4 (arbitrary-value utilities, `lg:` breakpoint), vite-plugin-pwa (untouched this phase).

**Spec:** `docs/superpowers/plans/2026-08-31-ux-enhancements-roadmap.md` (Phase 0; decisions D-A confirmed). Findings addressed: M1–M4, M7.

## Global Constraints

- Run in `frontend/`: `npm run typecheck` and `npm run lint` after every task; both must pass.
- No comments in code unless asked (AGENTS.md). Do not add any.
- Sidebar appearance and behavior at ≥ `lg` must remain pixel-identical to today.
- Manual verification at 390×844 (mobile viewport, devtools) and 1440×900 (desktop) after every task.
- Existing test convention: `npx tsx scripts/test-*.mts` from `frontend/`.

---

### Task 1: Viewport meta + safe-area foundations

**Files:**
- Modify: `frontend/index.html:7`

**Interfaces:**
- Produces: `viewport-fit=cover` on the document, enabling `env(safe-area-inset-*)` used in Tasks 3.

- [ ] **Step 1: Update the viewport meta**

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

- [ ] **Step 2: Verify**

Run: `npm run dev` in `frontend/`, open devtools at 390×844 with iPhone 14 Pro emulation (notched). Confirm the page renders to the screen edges in the emulator. Desktop 1440×900: no change.

- [ ] **Step 3: Commit**

```bash
git add frontend/index.html
git commit -m "feat(frontend): add viewport-fit=cover for notched-device safe areas"
```

### Task 2: Grid floor clamp (kills horizontal overflow)

**Files:**
- Modify: `frontend/src/lib/libraryStyle.ts` (add one exported helper next to the style-resolution helpers)
- Modify: `frontend/src/components/BookGrid.tsx:16`
- Test: `frontend/scripts/test-library-style.mts` (extend; it already tests this module's pure string logic)

**Interfaces:**
- Produces: `gridColumnsCss(cardMinWidth: number): string` — the `minmax()` first argument; used by `BookGrid` only.

- [ ] **Step 1: Write the failing test**

Append to `frontend/scripts/test-library-style.mts`:

```ts
// gridColumnsCss — the minmax() floor must clamp so a user-styled
// cardMinWidth larger than the viewport never forces horizontal scroll.
{
  const { gridColumnsCss } = await import("../src/lib/libraryStyle");
  const got = gridColumnsCss(200);
  if (got !== "min(200px, 100%)") throw new Error(`gridColumnsCss(200) => ${got}`);
  if (gridColumnsCss(120) !== "min(120px, 100%)") throw new Error("gridColumnsCss(120) wrong");
  passed("gridColumnsCss clamps to 100%");
}
```

Follow the file's existing `passed(...)`/error style — read its top first and match it; if it uses plain `console.assert` or a different helper, use that instead of inventing a new one.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scripts/test-library-style.mts` (from `frontend/`)
Expected: FAIL — `gridColumnsCss` is not exported.

- [ ] **Step 3: Implement**

In `frontend/src/lib/libraryStyle.ts`, export:

```ts
export function gridColumnsCss(cardMinWidth: number): string {
  return `min(${cardMinWidth}px, 100%)`;
}
```

In `frontend/src/components/BookGrid.tsx`, change the `gridTemplateColumns` line to:

```ts
gridTemplateColumns: `repeat(auto-fill, minmax(${gridColumnsCss(style.cardMinWidth)}, 1fr))`,
```

with `gridColumnsCss` added to the existing import from `../lib/libraryStyle`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scripts/test-library-style.mts`
Expected: PASS including the new check.

- [ ] **Step 5: Verify manually**

With the sidebar still fixed (Task 3 not yet done), devtools at 390×844 on `/dashboard`: the grid area (166px wide) no longer produces a horizontal scrollbar — columns render at ~166px wide instead of forcing 200px. Desktop: visually identical (200px floor < available width).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/libraryStyle.ts frontend/src/components/BookGrid.tsx frontend/scripts/test-library-style.mts
git commit -m "fix(frontend): clamp book-grid column floor to viewport width"
```

### Task 3: Responsive shell — bottom tabs + More drawer below `lg`

**Files:**
- Modify: `frontend/src/layouts/DashboardLayout.tsx` (rewrite; it is 72 lines)

**Interfaces:**
- Consumes: existing `useAuth()` (`session`, `logout`), `useQuery` library read for background color (unchanged).
- Produces: none (self-contained layout).

- [ ] **Step 1: Rewrite `DashboardLayout.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { fetchLibrary } from "../api/library";
import { useAuth } from "../auth/AuthContext";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Library", end: true },
  { to: "/dashboard/series", label: "Series", end: false },
  { to: "/dashboard/collections", label: "Collections", end: false },
  { to: "/dashboard/gallery", label: "Gallery", end: false },
  { to: "/dashboard/murals", label: "Murals", end: false },
  { to: "/dashboard/arena", label: "Arena", end: false },
  { to: "/dashboard/style", label: "Library style", end: false },
  { to: "/dashboard/settings", label: "Settings", end: false }
];

const TAB_ITEMS = NAV_ITEMS.slice(0, 3);

export function DashboardLayout() {
  const { session, logout } = useAuth();
  const { data: library } = useQuery({ queryKey: ["library"], queryFn: fetchLibrary });
  const backgroundColor = library?.data.style?.backgroundColor ?? undefined;
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [drawerOpen]);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
      isActive
        ? "bg-(--color-accent-soft) text-(--color-accent)"
        : "text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)"
    }`;

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-(--color-border) bg-(--color-surface) px-3 py-5 lg:flex">
        <div className="mb-6 flex items-center gap-2 px-2">
          <img src="/icon-192.png" alt="" className="h-7 w-7 rounded-md" />
          <span className="text-lg font-bold">Scripta</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto border-t border-(--color-border) pt-3">
          <p className="mb-2 truncate px-2 text-xs text-(--color-text-dim)">@{session?.user.username ?? session?.user.email}</p>
          <button
            onClick={() => void logout()}
            className="w-full rounded-lg border border-(--color-danger-soft) px-3 py-2.5 text-left text-sm text-(--color-danger) hover:bg-(--color-danger-soft)"
          >
            Log out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] lg:pb-0" style={{ backgroundColor }}>
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-(--color-border) bg-(--color-surface) pb-[env(safe-area-inset-bottom,0px)] lg:hidden">
        {TAB_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex h-14 flex-1 items-center justify-center text-[13px] font-medium ${
                isActive ? "text-(--color-accent)" : "text-(--color-text-dim)"
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
        <button
          onClick={() => setDrawerOpen(true)}
          aria-expanded={drawerOpen}
          className={`h-14 flex-1 text-[13px] font-medium ${drawerOpen ? "text-(--color-accent)" : "text-(--color-text-dim)"}`}
        >
          More
        </button>
      </nav>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 lg:hidden" onClick={() => setDrawerOpen(false)}>
          <aside
            className="flex h-full w-72 max-w-[85%] flex-col overflow-y-auto border-r border-(--color-border) bg-(--color-surface) px-3 py-5 pb-[env(safe-area-inset-bottom,0px)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex items-center gap-2 px-2">
              <img src="/icon-192.png" alt="" className="h-7 w-7 rounded-md" />
              <span className="text-lg font-bold">Scripta</span>
            </div>
            <nav className="flex flex-1 flex-col gap-1">
              {NAV_ITEMS.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass} onClick={() => setDrawerOpen(false)}>
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-6 border-t border-(--color-border) pt-3">
              <p className="mb-2 truncate px-2 text-xs text-(--color-text-dim)">@{session?.user.username ?? session?.user.email}</p>
              <button
                onClick={() => void logout()}
                className="w-full rounded-lg border border-(--color-danger-soft) px-3 py-2.5 text-left text-sm text-(--color-danger) hover:bg-(--color-danger-soft)"
              >
                Log out
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
```

Notes for the implementer: the existing file's header doc comment and the library-query comment should be preserved verbatim from the current file (they explain the shared `["library"]` cache read). Nav item padding went `py-2` → `py-2.5` (Task 5's touch-target work, applied here since the file is being rewritten).

- [ ] **Step 2: Typecheck and lint**

Run: `npm run typecheck && npm run lint` (from `frontend/`)
Expected: both pass.

- [ ] **Step 3: Verify manually**

At 390×844: no sidebar; bottom bar shows Library/Series/Collections/More, active tab is accent-colored; "More" opens the drawer; tapping a drawer destination navigates and closes; backdrop tap and Escape close it; every destination including Settings and logout reachable; content not hidden behind the bottom bar (grid's last row scrolls clear). At 1440×900: sidebar identical to before this task; no bottom bar; no visual diff.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/layouts/DashboardLayout.tsx
git commit -m "feat(frontend): responsive shell with bottom tabs and More drawer below lg"
```

### Task 4: iOS focus-zoom fix (16px input floor on coarse pointers)

**Files:**
- Modify: `frontend/src/index.css` (append after the existing `select, option` rule)

- [ ] **Step 1: Add the media rule**

```css
@media (pointer: coarse) {
  input,
  select,
  textarea {
    font-size: 16px !important;
  }
}
```

`!important` is required: inputs carry Tailwind size classes (`text-[15px]`, `text-sm`) that outrank an element selector; the coarse-pointer media query is the only place this override ever applies, so the blast radius is touch devices only.

- [ ] **Step 2: Verify manually**

Devtools at 390×844 with touch emulation on `/login`: focus the email/identifier field — no page zoom. On desktop: login fields unchanged (media query does not match).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/index.css
git commit -m "fix(frontend): 16px input floor on coarse pointers to stop iOS focus zoom"
```

### Task 5: Touch-target bump on remaining small controls

**Files:**
- Modify: `frontend/src/pages/LibraryPage.tsx` (header buttons: the select-mode trio, Share, Import — lines ~285–323; empty-state "Choose a file" button ~355–361)
- Modify: `frontend/src/components/ConfirmDialog.tsx:91,100` (Cancel/Confirm buttons)

**Interfaces:** none.

- [ ] **Step 1: Bump LibraryPage header buttons**

Every header action button in `LibraryPage.tsx` currently uses `px-3 py-2 text-sm` (≈37px tall). Change to `px-3.5 py-2.5 text-sm` (≥44px) on: "Delete selected", "Cancel", "Select…", "Share", "Import library…/Import more…", and the empty-state primary button (`px-4 py-2` → `px-4 py-2.5`). Do not change anything else about them.

- [ ] **Step 2: Bump ConfirmDialog buttons**

Both buttons: `px-3 py-1.5` → `px-3 py-2.5`. (Their `text-sm` and colors stay.)

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 4: Verify manually**

390×844: all header buttons comfortably tappable; confirm dialog buttons tall enough to hit first try. Desktop: slightly airier buttons, nothing clipped or wrapped in the header row.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/LibraryPage.tsx frontend/src/components/ConfirmDialog.tsx
git commit -m "fix(frontend): raise header and dialog button touch targets to 44px"
```

---

## Phase 0 exit criteria

- 390×844: every page (`/dashboard`, series, collections, gallery, murals, arena, style, settings) reachable, no horizontal scroll anywhere, no focus zoom on login, modals usable one-handed.
- 1440×900: no visual or behavioral change vs. the pre-phase app except slightly taller header/dialog buttons and nav items.
- `npm run typecheck`, `npm run lint`, and all `npx tsx scripts/test-*.mts` pass.

## Self-review

- Coverage vs. Phase 0 spec: M1→Task 2, M2→Task 3, M3→Tasks 1+3 (safe-area paddings in bar/drawer/main), M4→Task 4, M7→Tasks 3+5. Task 5 covers LibraryPage and ConfirmDialog; GroupsPage's identical toolbar gets the same bump in Phase 1's plan (that plan reads GroupsPage first) — noted there.
- Placeholder scan: every step carries exact code or an exact class-level instruction; no TBDs.
- Type consistency: `gridColumnsCss(cardMinWidth: number): string` matches its import and test. `NAV_ITEMS`/`TAB_ITEMS` shapes reused from the current file.
- `env(safe-area-inset-bottom,0px)` fallback keeps non-notched/desktop rendering identical.
