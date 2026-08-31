# Phase 4 — Accessibility Pass Implementation Plan

**Goal:** Book cards become real, labelled, keyboard-operable buttons with a real selection checkbox; covers carry a meaningful `alt` when they're the only card content; the login page gets AA-compliant label contrast and a visible keyboard focus ring.

**Architecture:** All changes are presentational/semantic edits inside `BookCard.tsx`, `LoginPage.tsx`, and one CSS consideration that already exists globally (index.css's `*:focus-visible` accent ring). dnd-kit already gives Library-grid cards `role="button"`/`tabIndex` via its attributes (Phase 2); this phase guarantees the same semantics everywhere a card renders, including select mode and Series/Collections, without breaking dnd's Space-to-lift behavior.

**Tech Stack:** React 19 + Vite + TS, Tailwind v4. No new deps, no backend changes, no new pure logic (verification is mechanical + manual keyboard pass).

**Spec:** `docs/superpowers/plans/2026-08-31-ux-enhancements-roadmap.md` (Phase 4). Findings addressed: D3 (card/checkbox semantics), D4 (nameless cards), D8 (login contrast). The roadmap's "focus visibility" item is already satisfied globally by index.css's `*:focus-visible` rule — the only gap is LoginPage's `outline-none`, fixed here. Pre-checked: dashboard `--color-text-dim` tokens pass AA in both themes (4.9:1 light, 6.3:1 dark) — no change needed.

## Global Constraints

- `npm run typecheck` and `npm run lint` (from `frontend/`); no new warnings beyond the 8 known (7 baseline + accepted `Toaster.tsx:75`).
- No comments in code.
- All `scripts/test-*.mts` suites stay green unmodified.
- Visual appearance must not change anywhere (checkbox keeps its exact look; only semantics/labels are added).

---

### Task 1: BookCard — semantics, accessible name, real checkbox

**Files:**
- Modify: `frontend/src/components/BookCard.tsx`

- [ ] **Step 1: Root semantics + keyboard activation**

On the root div, immediately after the conditional `{...(dragEnabled ? { ...attributes, ...listeners } : {})}` spread (so ours win any duplicate keys — same values where they overlap), add:

```tsx
role="button"
tabIndex={0}
onKeyDown={(e) => {
  if (e.key === "Enter" || (e.key === " " && !dragEnabled)) {
    e.preventDefault();
    if (selectable) onToggleSelect?.(book);
    else onClick();
  }
}}
```

(`Space` is excluded when `dragEnabled` because dnd-kit's KeyboardSensor already owns it for lift; `Enter` still activates. Cards without drag get both keys.)

- [ ] **Step 2: Accessible name when the overlay is hidden**

In `CoverImage`'s props (in the same file), add an optional `alt?: string` defaulting to `""`, and use it on the `<img>` in place of the hardcoded `alt=""`. In `BookCard`'s render call site:

```tsx
<CoverImage book={book} onHasCoverChange={setHasCover} alt={showOverlayText ? "" : String(book.Title ?? "Book cover")} />
```

(The mural blocks in `components/murals/blocks/BookBlocks.tsx` reuse `CoverImage` without `alt` — default `""` keeps their current behavior untouched.)

- [ ] **Step 3: Real checkbox for selection**

Replace the current selection badge block (the `selectable &&` div with the inline SVG checkmark) with a visual div plus a real, invisible-but-focusable checkbox laid exactly over it:

```tsx
{selectable && (
  <>
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute top-2.5 left-2.5 flex h-6 w-6 items-center justify-center rounded-full border-2 backdrop-blur-xs ${
        selected ? "border-(--color-accent) bg-(--color-accent)" : "border-white/70 bg-[rgba(10,8,6,0.4)]"
      }`}
    >
      {selected && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </div>
    <input
      type="checkbox"
      checked={selected}
      onChange={() => onToggleSelect?.(book)}
      onClick={(e) => e.stopPropagation()}
      aria-label={`Select ${String(book.Title ?? "this book")}`}
      className="absolute top-2.5 left-2.5 h-6 w-6 cursor-pointer appearance-none bg-transparent"
    />
  </>
)}
```

(`pointer-events-none` + `aria-hidden` on the visual; the native input is transparent via `appearance-none` (so no native glyph renders) but NOT `opacity-0` (opacity would hide the global `:focus-visible` outline too — `appearance-none` leaves the outline intact). `stopPropagation` on its click stops the card's own onClick from double-toggling; `onChange` drives the state.)

- [ ] **Step 4: Verify mechanically**

`npm run typecheck && npm run lint` — pass, no new warnings. `npx tsx scripts/test-library-order.mts` + `npx tsx scripts/test-library-view.mts` still pass.

- [ ] **Step 5: Verify manually (keyboard-only pass)**

On `/dashboard` with the backend up, unplug the mouse:
1. Tab cycles: sidebar → toolbar controls → book cards (each shows the accent focus ring) → header buttons.
2. Enter on a card opens the detail sheet; Escape closes; focus returns sensibly.
3. Enter select mode via keyboard; Tab to a card, Space toggles selection (and does NOT start a drag — drag only arms after the 150ms pointer hold; keyboard Space with drag enabled lifts a drag instead, per Phase 2 — confirm Space on a card OUTSIDE select mode lifts the dnd drag, arrows move, Space drops).
4. Tab into select mode reaches the real checkbox per card (screen-reader announces "Select <title>, checkbox, not checked"); the visual badge is unchanged.
5. On `/dashboard/style`, turn "show title and author" off with a cover present: the img now has alt = the title (inspect DOM); with the overlay on, alt stays "".

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/BookCard.tsx
git commit -m "feat(frontend): keyboard and screen-reader accessible book cards"
```

### Task 2: Login page — contrast + focus ring

**Files:**
- Modify: `frontend/src/pages/LoginPage.tsx`

- [ ] **Step 1: Bump `PAPER_DIM` opacity**

Change the constant:

```ts
const PAPER_DIM = "rgba(242, 237, 230, 0.65)";
```

(0.45 blends to ~4.0:1 on the ink ground — fails AA even for the small uppercase labels; 0.65 blends to ~7.2:1 — passes with margin. Every `PAPER_DIM` consumer — labels, inactive mode toggle, tagline, divider — moves together, keeping the hierarchy intact.)

- [ ] **Step 2: Keyboard focus ring on the underline fields**

In `fieldClass`, replace `outline-none` with:

```
focus-visible:outline-2 focus-visible:outline-[#e08a52]
```

(The global `*:focus-visible` rule would otherwise paint the theme accent — which in a light OS theme is a low-contrast brown on this page's fixed dark ground; the page's own GOLD value keeps the ring legible without affecting mouse users, who only ever see the border-color change.)

- [ ] **Step 3: Verify**

`npm run typecheck && npm run lint` — pass, no new warnings. Manual: Tab through the login form — each field shows the gold focus ring on keyboard focus only; visually the page reads the same at a glance (slightly brighter secondary text).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/LoginPage.tsx
git commit -m "fix(frontend): AA label contrast and keyboard focus ring on login"
```

---

## Phase 4 exit criteria

- Every card is operable by keyboard on every page it renders (open sheet / toggle selection / drag via dnd keys), announces as a button with the book's name when the overlay text is hidden, and exposes a real labelled checkbox in select mode.
- Login labels pass AA; keyboard focus visible on all fields.
- `typecheck`, `lint`, all suites pass; no visual regressions.

## Self-review

- Coverage: D3 → Task 1 Steps 1+3; D4 → Task 1 Step 2; D8 → Task 2; focus-visibility remainder → Task 2 Step 2 (global rule pre-existed). Dashboard dim-text tokens pre-checked, no task needed.
- Space/Enter vs dnd-kit conflict resolved explicitly (Step 1); checkbox double-toggle resolved via stopPropagation (Step 3); `CoverImage` reuse by murals kept behavior-identical via default `alt=""` (Step 2).
- No placeholders; all code exact.
