# Phase 6 — Polish (Nav IA, 404, Cover Fade, Public Pages) Implementation Plan

**Goal:** Regroup navigation with section dividers and one-line descriptions for Murals/Arena; a real 404 page instead of the silent wildcard redirect; covers fade in instead of popping; small public-page polish (owner button targets, Arena empty-state copy) — closing out the roadmap.

**Architecture:** Four independent small tasks. Nav regrouping restructures `NAV_ITEMS` into groups rendered with dividers in both the ≥`lg` sidebar and the mobile drawer (descriptions render in the drawer; `title` attributes in the sidebar). The 404 replaces the `*` redirect route. Cover fade-in is a self-resetting `loadedSrc` comparison inside `CoverImage` — no effects, no lint exposure. Public-page audit findings are already scoped (BracketTree scrolls internally; DuelCard vote targets are whole-card buttons — fine): only ArenaViewPage's owner controls and ArenaPublicListPage's empty copy need changes.

**Tech Stack:** React 19 + Vite + TS, Tailwind v4. No new deps.

**Spec:** `docs/superpowers/plans/2026-08-31-ux-enhancements-roadmap.md` (Phase 6). Findings addressed: D7, D9, D11, M9.

## Global Constraints

- `npm run typecheck` and `npm run lint` (from `frontend/`); no new warnings beyond the 8 known.
- No comments in code; preserve existing comments.
- All suites stay green; `npm run build` passes.

---

### Task 1: Nav IA — grouped sections + Murals/Arena descriptions

**Files:**
- Modify: `frontend/src/layouts/DashboardLayout.tsx`
- Modify: `frontend/README.md` (sidebar sentence)

- [ ] **Step 1: Restructure nav data**

Replace `NAV_ITEMS`/`TAB_ITEMS` with:

```tsx
interface NavItem {
  to: string;
  label: string;
  end: boolean;
  description?: string;
}

const NAV_GROUPS: Array<{ items: NavItem[] }> = [
  {
    items: [
      { to: "/dashboard", label: "Library", end: true },
      { to: "/dashboard/series", label: "Series", end: false },
      { to: "/dashboard/collections", label: "Collections", end: false }
    ]
  },
  {
    items: [
      { to: "/dashboard/gallery", label: "Gallery", end: false },
      { to: "/dashboard/murals", label: "Murals", end: false, description: "Freeform dashboard pages" },
      { to: "/dashboard/arena", label: "Arena", end: false, description: "Book-bracket tournaments" }
    ]
  },
  {
    items: [
      { to: "/dashboard/style", label: "Library style", end: false },
      { to: "/dashboard/settings", label: "Settings", end: false }
    ]
  }
];

const TAB_ITEMS = NAV_GROUPS[0].items;
```

- [ ] **Step 2: Render groups in the sidebar (≥`lg`)**

Map `NAV_GROUPS` with a divider `<div className="my-3 border-t border-(--color-border)" />` between groups (not before the first). Each `NavLink` unchanged except an added `title={item.description}`.

- [ ] **Step 3: Render groups in the mobile drawer**

Same grouped rendering with dividers; each item becomes label plus, when present:

```tsx
{item.description && <span className="block text-xs font-normal text-(--color-text-dim)">{item.description}</span>}
```

(inside the `NavLink`, under the label). Keep the drawer's close-on-navigate `onClick` and the account/logout block as-is.

- [ ] **Step 4: README**

In `frontend/README.md`, update the DashboardLayout description sentence (the one enumerating "Library / Series / Collections / Gallery / Murals / Arena / Library style / Settings") to note the nav is grouped (library content / more tools / preferences) and that below `lg` it's a bottom tab bar + More drawer (Phases 0–2 behavior, now documented).

- [ ] **Step 5: Verify + commit**

`npm run typecheck && npm run lint` — pass, no new warnings. Desktop: sidebar shows three groups with hairline dividers, tooltips on Murals/Arena. Mobile 390×844: drawer shows descriptions; bottom tabs unchanged (first three items).

```bash
git add frontend/src/layouts/DashboardLayout.tsx frontend/README.md
git commit -m "feat(frontend): grouped nav sections with Murals/Arena descriptions"
```

### Task 2: 404 page

**Files:**
- Create: `frontend/src/pages/NotFoundPage.tsx`
- Modify: `frontend/src/App.tsx:62`

- [ ] **Step 1: Create the page with EXACTLY:**

```tsx
import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-5 text-center">
      <h1 className="text-xl font-bold">This page doesn't exist.</h1>
      <p className="text-sm text-(--color-text-dim)">The link may be old or mistyped.</p>
      <Link
        to="/dashboard"
        className="rounded-lg bg-(--color-accent) px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
      >
        Go to your library
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Swap the wildcard route**

In `App.tsx`, replace `<Route path="*" element={<Navigate to="/dashboard" replace />} />` with `<Route path="*" element={<NotFoundPage />} />` (plus the import; drop the `Navigate` import if now unused — it is).

- [ ] **Step 3: Verify + commit**

Typecheck/lint pass. Manual: visit `/nope` signed out → 404 renders (link leads to login flow); signed in → link goes to the library. A bad share token now shows 404 instead of a confusing login redirect.

```bash
git add frontend/src/pages/NotFoundPage.tsx frontend/src/App.tsx
git commit -m "feat(frontend): real 404 page for unknown routes"
```

### Task 3: Cover fade-in

**Files:**
- Modify: `frontend/src/components/BookCard.tsx` (`CoverImage` only)

- [ ] **Step 1: Track the loaded src**

In `CoverImage`: add `const [loadedSrc, setLoadedSrc] = useState<string | null>(null);` beside the existing state. On the `<img>`: add `onLoad={() => setLoadedSrc(currentSrc)}` and change the className to include:

```
transition-opacity duration-200 ${loadedSrc === currentSrc ? "opacity-100" : "opacity-0"}
```

(keeping the existing absolute/inset/object classes and the no-lazy-loading comment). The comparison against `currentSrc` (not a boolean) makes the fade self-reset whenever the src changes — book swap, confirmed-failure fallback to auto-resolve — with no effects and no lint exposure.

- [ ] **Step 2: Verify + commit**

Typecheck/lint pass (no new warnings — this must NOT add a `set-state-in-effect` warning; if it does, the implementation deviated from this design). Manual: cold reload — covers fade in ~200ms; a re-resolving cover fades again rather than popping.

```bash
git add frontend/src/components/BookCard.tsx
git commit -m "feat(frontend): fade covers in on load"
```

### Task 4: Public pages — owner controls + Arena copy

**Files:**
- Modify: `frontend/src/pages/ArenaViewPage.tsx`
- Modify: `frontend/src/pages/ArenaPublicListPage.tsx`

- [ ] **Step 1: Bump owner control targets**

In `ArenaViewPage.tsx`: "Settle now" button `py-1` → `py-2`; both tie-break buttons `py-1` → `py-2`. Nothing else.

- [ ] **Step 2: Explain Arena on the public list's empty state**

In `ArenaPublicListPage.tsx` (line ~21), change `No tournaments yet.` to:

```
No tournaments yet. A tournament is a bracket where friends vote books head-to-head — check back soon.
```

- [ ] **Step 3: Verify + commit**

Typecheck/lint pass. Manual 390×844 sweep of `/arena`, `/arena/:id` (bracket scrolls internally, vote cards comfortably tappable), and a `/shared/library/:token` + `/shared/murals/:token` pair (BookGrid collapses to one column; no document-level horizontal scroll anywhere).

```bash
git add frontend/src/pages/ArenaViewPage.tsx frontend/src/pages/ArenaPublicListPage.tsx
git commit -m "fix(frontend): public arena page touch targets and empty-state copy"
```

---

## Phase 6 exit criteria

- Sidebar/drawer grouped with dividers; Murals/Arena self-explanatory in the drawer; bottom tabs unchanged.
- Unknown routes show a real 404.
- Covers fade in; re-resolves fade rather than pop.
- Public pages clean at 390px; owner controls tappable.
- `typecheck`, `lint` (8 known), `build`, all suites pass.

## Self-review

- Coverage: D7 → Task 1 (grouping + descriptions; "Library style" scope renames deliberately deferred — copy change would churn routes/links for little gain, documented here as a conscious scope cut); D9 → Task 2; D11 → Task 3; M9 → Task 4 + verified-OK findings recorded (BracketTree `overflow-x-auto` pre-existed; DuelCard whole-card vote targets; shared pages already use responsive PageContainer/BookGrid).
- Murals empty state already explains murals (verified `MuralsListPage.tsx:184`) — no task needed.
- No placeholders; all code exact; Task 3's design explicitly avoids a new lint warning.
