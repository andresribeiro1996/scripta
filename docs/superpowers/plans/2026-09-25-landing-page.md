# Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A marketing landing page at `/` in the frontend that onboards new
users (real sign-up via `/login?mode=signup`), showcases Scripta's features
with CSS-built mockups, and redirects signed-in users to `/dashboard`.

**Architecture:** One new route element (`LandingPage`) composing seven
small section components under `components/landing/`. Pure decision logic
(redirect, auth-mode param) lives in `src/lib/landing.ts` so node:test can
reach it. All styling through the existing `--color-*` Tailwind token
classes — the page follows the OS theme like every other screen.

**Tech Stack:** React 19 + react-router-dom 7 + Tailwind v4 (repo's
`bg-(--color-*)` syntax), node:test via `tsx --test scripts/test-*.mts`,
oxlint.

**Spec:** `docs/superpowers/specs/2026-09-25-landing-page-design.md`

## Global Constraints

- Tokens only: style with `bg-(--color-bg)`, `text-(--color-text)`,
  `text-(--color-text-dim)`, `bg-(--color-surface)`,
  `border-(--color-border)`, `bg-(--color-accent)`,
  `bg-(--color-accent-soft)`, `text-(--color-accent)`, and the new
  `--color-on-accent`. The only raw hexes allowed are the tier-list preset
  colors (`#c9482f #d98a3d #c9a53d #5c9e5c #4a7fc9` — per-tierlist mutable
  data, not theme tokens) and the mock cover gradients (built from the
  palette's own hex values listed in each task).
- No new npm dependencies. No new colors/radii/breakpoints beyond the
  `--color-on-accent` token addition in Task 3.
- No comments in code (repo rule). Exact code below already reflects that.
- Tailwind radius mapping used throughout: `rounded-lg` 8px (buttons),
  `rounded-xl` 12px (cards), `rounded-2xl` 16px (book covers),
  `rounded-full` pills.
- Verify commands run from the repo root unless noted:
  - `npm run build --workspace @scripta/shared`
  - `npm run typecheck --workspace frontend`
  - `npm run lint --workspace frontend`
  - `npm test --workspace frontend`
- Consumer rule: rebuild `@scripta/shared` before frontend typecheck/tests
  if shared changed (it does not change in this plan; Task 8 runs it anyway
  as the full gate).
- Commit after every task. Never weaken auth/validation to make tests pass.

---

### Task 1: Pure helpers + tests (`lib/landing.ts`)

**Files:**
- Create: `frontend/src/lib/landing.ts`
- Test: `frontend/scripts/test-landing.mts`

**Interfaces:**
- Consumes: `type Session` from `frontend/src/auth/tokenStore.ts`
  (type-only import; erased at runtime, so the module stays importable from
  node:test).
- Produces:
  - `landingDestination(session: Session | null): string | null` —
    `"/dashboard"` when a session exists, `null` otherwise.
  - `type AuthMode = "login" | "signup"`
  - `modeFromSearch(params: URLSearchParams): AuthMode` — `"signup"` only
    for `mode=signup`, `"login"` for everything else.

- [ ] **Step 1: Write the failing test**

Create `frontend/scripts/test-landing.mts`:

```mts
import assert from "node:assert/strict";
import { test } from "node:test";
import { landingDestination, modeFromSearch } from "../src/lib/landing.ts";

test("a session routes to the dashboard; a stranger gets the landing page", () => {
  const session = { user: { id: "reader", email: "reader@example.com", username: "reader", avatarId: null }, accessToken: "access", refreshToken: "refresh" };
  assert.equal(landingDestination(session), "/dashboard");
  assert.equal(landingDestination(null), null);
});

test("the landing CTAs land on signup; everything else lands on login", () => {
  assert.equal(modeFromSearch(new URLSearchParams("mode=signup")), "signup");
  assert.equal(modeFromSearch(new URLSearchParams("mode=login")), "login");
  assert.equal(modeFromSearch(new URLSearchParams("mode=bogus")), "login");
  assert.equal(modeFromSearch(new URLSearchParams("")), "login");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace frontend`
Expected: FAIL — cannot find module `../src/lib/landing.ts`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/landing.ts`:

```ts
import type { Session } from "../auth/tokenStore";

export type AuthMode = "login" | "signup";

export function landingDestination(session: Session | null): string | null {
  return session ? "/dashboard" : null;
}

export function modeFromSearch(params: URLSearchParams): AuthMode {
  return params.get("mode") === "signup" ? "signup" : "login";
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace frontend`
Expected: PASS — all files, including the new `test-landing.mts`.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck --workspace frontend && npm run lint --workspace frontend`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/landing.ts frontend/scripts/test-landing.mts
git commit -m "Add landing-page pure helpers: auth redirect and signup-mode param"
```

---

### Task 2: LoginPage accepts `?mode=signup`

**Files:**
- Modify: `frontend/src/pages/LoginPage.tsx:40` and `:47`

**Interfaces:**
- Consumes: `modeFromSearch`, `type AuthMode` from
  `frontend/src/lib/landing.ts` (Task 1).

- [ ] **Step 1: Replace the local Mode type with the imported one**

In `frontend/src/pages/LoginPage.tsx`, delete line 40:

```tsx
type Mode = "login" | "signup";
```

and add to the import block (after the `@scripta/shared` import at line 1,
grouped with the relative imports — insert a new import line after line 3's
`../auth/returnTo` import):

```tsx
import { modeFromSearch, type AuthMode as Mode } from "../lib/landing";
```

- [ ] **Step 2: Initialize mode from the query param**

Change line 47 from:

```tsx
  const [mode, setMode] = useState<Mode>("login");
```

to:

```tsx
  const [mode, setMode] = useState<Mode>(() => modeFromSearch(new URLSearchParams(location.search)));
```

(`location` is already in scope — `useLocation()` at line 45, defined
before line 47. The parse is covered by `test-landing.mts` from Task 1;
nothing new to test here.)

- [ ] **Step 3: Verify**

Run: `npm run typecheck --workspace frontend && npm test --workspace frontend`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/LoginPage.tsx
git commit -m "LoginPage opens in signup mode via ?mode=signup"
```

---

### Task 3: Route, page shell, nav/footer, `on-accent` token, smooth scroll

The page goes live at `/` in this task with nav + footer; the middle
sections arrive in Tasks 4–7.

**Files:**
- Modify: `frontend/src/index.css` (`@theme` blocks + motion block)
- Create: `frontend/src/components/landing/LandingNav.tsx`
- Create: `frontend/src/components/landing/LandingFooter.tsx`
- Create: `frontend/src/pages/LandingPage.tsx`
- Modify: `frontend/src/App.tsx:1-38`

**Interfaces:**
- Consumes: `landingDestination` from `frontend/src/lib/landing.ts`
  (Task 1); `useAuth` from `frontend/src/auth/AuthContext.tsx`.
- Produces: `LandingPage` (exported, no props) — used by `App.tsx`.
  `LandingPage`'s `<main>` gains `LandingHero` in Task 4,
  `FeatureGrid` in Task 5, `MuralShowcase` in Task 6,
  `ArenaShowcase` + `GetApp` in Task 7.

- [ ] **Step 1: Add the `on-accent` token to both theme blocks**

In `frontend/src/index.css`, inside the first `@theme` block (after line 63
`--color-reference-soft: #ebe4f3;`), add:

```css
  --color-on-accent: #ffffff;
```

Inside the dark `@theme` block (after its `--color-reference-soft:
#2c2536;` line), add:

```css
    --color-on-accent: #1a1815;
```

(Values are DESIGN.md's `on-accent` row verbatim.)

- [ ] **Step 2: Smooth-scroll anchors, gated like the rest of the motion**

In `frontend/src/index.css`, inside the existing
`@media (prefers-reduced-motion: no-preference)` block (line 403), add as
the first rule of the block:

```css
  html {
    scroll-behavior: smooth;
  }
```

- [ ] **Step 3: Create the nav**

Create `frontend/src/components/landing/LandingNav.tsx`:

```tsx
import { Link } from "react-router-dom";

const anchors = [
  ["Features", "#features"],
  ["Murals", "#murals"],
  ["Arena", "#arena"],
  ["Get the app", "#app"],
] as const;

export function LandingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-(--color-border) bg-(--color-bg)">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link to="/" aria-label="Scripta home">
          <img src="/icon-512.png" alt="" className="h-8 w-8 rounded-lg" />
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-semibold text-(--color-text-dim) sm:flex">
          {anchors.map(([label, href]) => (
            <a key={href} href={href} className="transition-colors hover:text-(--color-text)">
              {label}
            </a>
          ))}
        </nav>
        <Link
          to="/login"
          className="rounded-lg bg-(--color-accent) px-4 py-2 text-sm font-semibold text-(--color-on-accent) transition-opacity hover:opacity-90"
        >
          Sign in
        </Link>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Create the footer**

Create `frontend/src/components/landing/LandingFooter.tsx`:

```tsx
import { Link } from "react-router-dom";

export function LandingFooter() {
  return (
    <footer className="border-t border-(--color-border)">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 py-10 text-sm text-(--color-text-dim) sm:flex-row sm:justify-between">
        <div className="flex items-center gap-3">
          <img src="/icon-512.png" alt="" className="h-6 w-6 rounded-md" />
          <span>Your reading life, in one place.</span>
        </div>
        <div className="flex items-center gap-5 font-semibold">
          <Link to="/login" className="transition-colors hover:text-(--color-text)">
            Sign in
          </Link>
          <Link to="/login?mode=signup" className="transition-colors hover:text-(--color-text)">
            Create account
          </Link>
        </div>
      </div>
    </footer>
  );
}
```

- [ ] **Step 5: Create the page**

Create `frontend/src/pages/LandingPage.tsx`:

```tsx
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { landingDestination } from "../lib/landing";
import { LandingNav } from "../components/landing/LandingNav";
import { LandingFooter } from "../components/landing/LandingFooter";

export function LandingPage() {
  const { session } = useAuth();
  const destination = landingDestination(session);
  if (destination) return <Navigate to={destination} replace />;
  return (
    <div className="min-h-screen bg-(--color-bg) text-(--color-text)">
      <LandingNav />
      <main />
      <LandingFooter />
    </div>
  );
}
```

- [ ] **Step 6: Wire the route**

In `frontend/src/App.tsx`, add to the imports:

```tsx
import { LandingPage } from "./pages/LandingPage";
```

and replace line 38:

```tsx
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
```

with:

```tsx
        <Route path="/" element={<LandingPage />} />
```

(`Navigate` stays imported — still used at lines 44 and 83.)

- [ ] **Step 7: Verify**

Run: `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend && npm run build --workspace frontend`
Expected: all pass.

Then visual check: start the dev server
(`npm run dev --workspace frontend`, backend not required for this page)
and check:
- `http://localhost:5173/` logged out → sticky nav (mark, 4 anchors
  hidden below `sm`, Sign in pill), empty middle, footer.
- Window at phone width → anchors hidden, nav still usable.
- OS dark mode → page follows (dark bg, white-glyph mark still visible).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/index.css frontend/src/components/landing/LandingNav.tsx frontend/src/components/landing/LandingFooter.tsx frontend/src/pages/LandingPage.tsx frontend/src/App.tsx
git commit -m "Landing page goes live at /: nav, footer, logged-in redirect"
```

---

### Task 4: Hero

**Files:**
- Create: `frontend/src/components/landing/LandingHero.tsx`
- Modify: `frontend/src/pages/LandingPage.tsx` (insert hero into `<main>`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `LandingHero` (exported, no props). `LandingPage` renders it
  as the first child of `<main>`.

- [ ] **Step 1: Create the hero**

Create `frontend/src/components/landing/LandingHero.tsx`:

```tsx
import { Link } from "react-router-dom";

const shelf = [
  { title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", from: "#a85c32", to: "#5c3a24", shift: "-64px", rotate: "-6deg" },
  { title: "Piranesi", author: "Susanna Clarke", from: "#6b4f8f", to: "#3c2d54", shift: "-32px", rotate: "3deg" },
  { title: "Project Hail Mary", author: "Andy Weir", from: "#285f7a", to: "#173544", shift: "0px", rotate: "-2deg" },
  { title: "Gilead", author: "Marilynne Robinson", from: "#47713c", to: "#2a4224", shift: "32px", rotate: "5deg" },
  { title: "Circe", author: "Madeline Miller", from: "#b3432f", to: "#5f241a", shift: "64px", rotate: "-4deg" },
];

function MockCover({ book, index }: { book: (typeof shelf)[number]; index: number }) {
  return (
    <div
      className="relative aspect-[2/3] w-32 shrink-0 rounded-2xl transition-transform duration-150 hover:-translate-y-1 sm:w-40"
      style={{
        background: `linear-gradient(160deg, ${book.from}, ${book.to})`,
        boxShadow: "inset 6px 0 8px -6px rgba(0,0,0,0.5), 0 8px 16px rgba(0,0,0,0.15)",
        transform: `translate(${book.shift}, 0) rotate(${book.rotate})`,
        zIndex: index,
      }}
    >
      <div className="absolute inset-0 flex flex-col justify-end p-3" style={{ fontFamily: '"Playfair Display", serif' }}>
        <p className="text-base leading-tight text-white">{book.title}</p>
        <p className="mt-1 text-xs text-white/80">{book.author}</p>
      </div>
    </div>
  );
}

export function LandingHero() {
  return (
    <section className="overflow-hidden">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 lg:grid-cols-2 lg:py-24">
        <div>
          <p className="text-sm font-semibold text-(--color-accent)">Your reading life, in one place</p>
          <h1 className="mt-3 text-4xl font-bold leading-tight sm:text-5xl" style={{ fontFamily: '"Playfair Display", serif' }}>
            The library behind your Kobo, finally on display.
          </h1>
          <p className="mt-4 max-w-xl text-lg text-(--color-text-dim)">
            Scripta imports your Kobo and Goodreads history and turns it into a
            library that's actually yours — styled book cards, collections,
            murals to publish, and book tournaments with friends.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/login?mode=signup"
              className="rounded-lg bg-(--color-accent) px-6 py-3 text-base font-semibold text-(--color-on-accent) transition-opacity hover:opacity-90"
            >
              Create your library
            </Link>
            <a
              href="#features"
              className="rounded-lg border border-(--color-border) bg-(--color-surface) px-6 py-3 text-base font-semibold transition-colors hover:bg-(--color-surface-hover)"
            >
              See how it works
            </a>
          </div>
        </div>
        <div className="flex justify-center py-6">
          <div className="flex">
            {shelf.map((book, index) => (
              <MockCover key={book.title} book={book} index={index} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
```

(The cover gradient hexes are the app's own palette values — accent,
reference, info, success, danger and darkened partners — used as demo cover
art, not new theme colors. The negative/positive `shift` values make the
row overlap into a fanned deck; the section's `overflow-hidden` clips the
overhang at phone widths.)

- [ ] **Step 2: Render it**

In `frontend/src/pages/LandingPage.tsx`, add the import and change
`<main />` to:

```tsx
      <main>
        <LandingHero />
      </main>
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm run build --workspace frontend`
Expected: all pass.

Dev server: `http://localhost:5173/` shows the hero — Playfair headline,
two CTAs, five fanned covers lifting on hover. At phone width the covers
clip at the section edge instead of causing horizontal scroll, and the
"Create your library" button lands on `/login?mode=signup` with the
**Sign up** tab pre-selected.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/landing/LandingHero.tsx frontend/src/pages/LandingPage.tsx
git commit -m "Landing hero: Playfair display line, CTAs, fanned cover mockup"
```

---

### Task 5: Features grid

**Files:**
- Create: `frontend/src/components/landing/FeatureGrid.tsx`
- Modify: `frontend/src/pages/LandingPage.tsx` (append to `<main>`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `FeatureGrid` (exported, no props), rendered after
  `LandingHero`.

- [ ] **Step 1: Create the grid**

Create `frontend/src/components/landing/FeatureGrid.tsx`:

```tsx
import type { ReactNode } from "react";

const features: { title: string; body: string; icon: ReactNode }[] = [
  {
    title: "Import from Kobo & Goodreads",
    body: "The exporter reads your Kobo's own database right off its USB drive; Goodreads comes in as a CSV. Your ratings, shelves and notes come with you.",
    icon: (
      <>
        <path d="M12 3v11m0 0 4-4m-4 4-4-4" />
        <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </>
    ),
  },
  {
    title: "A library that looks like you",
    body: "Book cards with your choice of cover typography, your grid size, your content width. Every cover, exactly the way you want to see it.",
    icon: (
      <>
        <rect x="4" y="4" width="7" height="10" rx="1.5" />
        <rect x="13" y="4" width="7" height="6" rx="1.5" />
        <rect x="13" y="12" width="7" height="8" rx="1.5" />
        <rect x="4" y="16" width="7" height="4" rx="1.5" />
      </>
    ),
  },
  {
    title: "Series & collections",
    body: "Group books the way you actually read them — a series in order, a themed shelf, a year in review.",
    icon: (
      <>
        <path d="M6 3h9a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
        <path d="M17 5h1a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-1" />
      </>
    ),
  },
  {
    title: "Share links",
    body: "Publish your library, a mural or a reading scoreboard at a public link. Anyone with the link can look; nobody needs an account.",
    icon: (
      <>
        <path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1.5 1.5" />
        <path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1.5-1.5" />
      </>
    ),
  },
  {
    title: "Web app, installable",
    body: "Works in any browser, installs as a PWA, and keeps your library readable offline.",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3a13.5 13.5 0 0 1 0 18a13.5 13.5 0 0 1 0-18" />
      </>
    ),
  },
  {
    title: "Mobile app",
    body: "A native-feeling app for your phone — browse, sort and vote from the couch.",
    icon: (
      <>
        <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
        <path d="M11 18h2" />
      </>
    ),
  },
];

function FeatureIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-(--color-accent-soft) text-(--color-accent)">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </span>
  );
}

export function FeatureGrid() {
  return (
    <section id="features" className="scroll-mt-14">
      <div className="mx-auto max-w-6xl px-4 py-16 lg:py-24">
        <h2 className="text-3xl font-bold">Everything your reading history wants to be</h2>
        <p className="mt-3 max-w-xl text-lg text-(--color-text-dim)">
          Import once, then shape it — Scripta is built around what a personal
          library can do that a spreadsheet can't.
        </p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div key={feature.title} className="rounded-xl border border-(--color-border) bg-(--color-surface) p-6">
              <FeatureIcon>{feature.icon}</FeatureIcon>
              <h3 className="mt-4 font-semibold">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-(--color-text-dim)">{feature.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

(`scroll-mt-14` offsets the sticky nav height on anchor jumps — same value
as the nav's `h-14`. The other anchor sections get it in Tasks 6–7.)

- [ ] **Step 2: Render it**

In `frontend/src/pages/LandingPage.tsx`, add the import and make `<main>`:

```tsx
      <main>
        <LandingHero />
        <FeatureGrid />
      </main>
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck --workspace frontend && npm run lint --workspace frontend`
Expected: pass.

Dev server: six feature cards below the hero, three per row on desktop,
one per row on phones; clicking "See how it works" scrolls to the grid and
clears the sticky nav.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/landing/FeatureGrid.tsx frontend/src/pages/LandingPage.tsx
git commit -m "Landing features grid: six cards with inline SVG icons"
```

---

### Task 6: Murals showcase

**Files:**
- Create: `frontend/src/components/landing/MuralShowcase.tsx`
- Modify: `frontend/src/pages/LandingPage.tsx` (append to `<main>`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `MuralShowcase` (exported, no props), rendered after
  `FeatureGrid`.

- [ ] **Step 1: Create the showcase**

Create `frontend/src/components/landing/MuralShowcase.tsx`:

```tsx
const shelfCovers = [
  { from: "#a85c32", to: "#5c3a24" },
  { from: "#285f7a", to: "#173544" },
  { from: "#47713c", to: "#2a4224" },
  { from: "#6b4f8f", to: "#3c2d54" },
  { from: "#b3432f", to: "#5f241a" },
];

export function MuralShowcase() {
  return (
    <section id="murals" className="scroll-mt-14 border-y border-(--color-border)">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 lg:grid-cols-2 lg:py-24">
        <div>
          <h2 className="text-3xl font-bold">Murals: your library, composed</h2>
          <p className="mt-3 max-w-xl text-lg text-(--color-text-dim)">
            Drag shelves, quotes, stats and photos onto a freeform canvas.
            Publish it at a link that shows your reading life the way you want
            it told.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4 sm:col-span-2">
            <div className="flex gap-2 overflow-hidden">
              {shelfCovers.map((cover, index) => (
                <div
                  key={index}
                  className="aspect-[2/3] w-14 shrink-0 rounded-md"
                  style={{ background: `linear-gradient(160deg, ${cover.from}, ${cover.to})` }}
                />
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-5">
            <p className="text-lg leading-snug" style={{ fontFamily: '"Playfair Display", serif' }}>
              “A reader lives a thousand lives before he dies.”
            </p>
            <p className="mt-2 text-xs text-(--color-text-dim)">George R. R. Martin</p>
          </div>
          <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-5">
            <p className="text-3xl font-bold text-(--color-accent)">312</p>
            <p className="text-xs text-(--color-text-dim)">books imported</p>
            <p className="mt-3 text-3xl font-bold text-(--color-accent)">48</p>
            <p className="text-xs text-(--color-text-dim)">finished this year</p>
          </div>
        </div>
      </div>
    </section>
  );
}
```

(The three blocks mirror the real `shelf` / `quote` / `stats` mural block
chrome — `radius-xl`/`border`/`surface` cards, accent numbers.)

- [ ] **Step 2: Render it**

In `frontend/src/pages/LandingPage.tsx`, add the import and append after
`<FeatureGrid />`:

```tsx
        <MuralShowcase />
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck --workspace frontend && npm run lint --workspace frontend`
Expected: pass.

Dev server: full-width band with top/bottom hairlines; shelf strip on top,
quote and stats cards beneath on mobile, beside the copy on desktop.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/landing/MuralShowcase.tsx frontend/src/pages/LandingPage.tsx
git commit -m "Murals showcase band: shelf, quote and stats block mockups"
```

---

### Task 7: Arena showcase + Get the app

**Files:**
- Create: `frontend/src/components/landing/ArenaShowcase.tsx`
- Create: `frontend/src/components/landing/GetApp.tsx`
- Modify: `frontend/src/pages/LandingPage.tsx` (append to `<main>`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ArenaShowcase` and `GetApp` (exported, no props), rendered
  after `MuralShowcase`. `GetApp` exports the two badge-URL constants
  (`APP_STORE_URL`, `PLAY_STORE_URL`) so the future store swap is a
  one-line edit each.

- [ ] **Step 1: Create the arena showcase**

Create `frontend/src/components/landing/ArenaShowcase.tsx`:

```tsx
const tiers = [
  { label: "S", color: "#c9482f" },
  { label: "A", color: "#d98a3d" },
  { label: "B", color: "#c9a53d" },
  { label: "C", color: "#5c9e5c" },
];

function MiniCover({ from, to }: { from: string; to: string }) {
  return (
    <div
      className="h-12 w-8 shrink-0 rounded-md"
      style={{ background: `linear-gradient(160deg, ${from}, ${to})` }}
    />
  );
}

export function ArenaShowcase() {
  return (
    <section id="arena" className="scroll-mt-14">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 lg:grid-cols-2 lg:py-24">
        <div className="order-2 lg:order-1">
          <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
            <p className="text-center text-xs font-semibold text-(--color-text-dim)">Which cover wins?</p>
            <div className="mt-3 flex items-stretch justify-center gap-3">
              <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-(--color-accent) p-3">
                <MiniCover from="#a85c32" to="#5c3a24" />
              </div>
              <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-(--color-border) p-3">
                <MiniCover from="#285f7a" to="#173544" />
              </div>
            </div>
            <div className="mt-3 h-2 rounded-full bg-(--color-border)">
              <div className="h-2 w-[62%] rounded-full bg-(--color-accent)" />
            </div>
            <p className="mt-1 text-right text-xs text-(--color-text-dim)">62% · 34 votes</p>
          </div>
          <div className="mt-4 overflow-hidden rounded-xl border border-(--color-border)">
            {tiers.map((tier) => (
              <div key={tier.label} className="flex items-center gap-3 border-b border-(--color-border) p-2 last:border-b-0">
                <span
                  className="flex h-9 w-11 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white"
                  style={{ backgroundColor: tier.color }}
                >
                  {tier.label}
                </span>
                <div className="flex gap-1.5">
                  <MiniCover from="#6b4f8f" to="#3c2d54" />
                  <MiniCover from="#47713c" to="#2a4224" />
                  <MiniCover from="#b3432f" to="#5f241a" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="order-1 lg:order-2">
          <h2 className="text-3xl font-bold">Arena: settle what's best, with friends</h2>
          <p className="mt-3 max-w-xl text-lg text-(--color-text-dim)">
            Seed a bracket of your books and vote through the duels, or drag
            your shelf onto a tier list. Tournaments end with a ranked,
            shareable result.
          </p>
        </div>
      </div>
    </section>
  );
}
```

(Tier hexes are DESIGN.md's default tier presets. The duel card follows the
real `DuelCard`: 2px borders, the accent-bordered side is the winner, tally
bar accent-on-border.)

- [ ] **Step 2: Create the get-the-app section**

Create `frontend/src/components/landing/GetApp.tsx`:

```tsx
import { Link } from "react-router-dom";

export const APP_STORE_URL = "#";
export const PLAY_STORE_URL = "#";

const gridCovers = ["#a85c32", "#285f7a", "#6b4f8f", "#47713c", "#b3432f", "#a85c32"];

function StoreBadge({ href, store, label }: { href: string; store: string; label: string }) {
  return (
    <a
      href={href}
      rel="noreferrer"
      aria-label={`${label} — ${store}`}
      className="inline-flex flex-col rounded-lg bg-(--color-text) px-4 py-2 text-(--color-bg) transition-opacity hover:opacity-90"
    >
      <span className="text-[10px] leading-tight opacity-80">Download on the</span>
      <span className="text-sm font-bold leading-tight">{store}</span>
    </a>
  );
}

export function GetApp() {
  return (
    <section id="app" className="scroll-mt-14 border-t border-(--color-border)">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 lg:grid-cols-2 lg:py-24">
        <div>
          <h2 className="text-3xl font-bold">Take your library off the desk</h2>
          <p className="mt-3 max-w-xl text-lg text-(--color-text-dim)">
            The mobile app puts your shelves, murals and arena votes in your
            pocket — or keep using Scripta right in the browser.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <StoreBadge href={APP_STORE_URL} store="App Store" label="Get Scripta on the App Store" />
            <StoreBadge href={PLAY_STORE_URL} store="Google Play" label="Get Scripta on Google Play" />
          </div>
          <p className="mt-4 text-sm text-(--color-text-dim)">
            Prefer the browser?{" "}
            <Link to="/login?mode=signup" className="font-semibold text-(--color-accent) hover:opacity-80">
              Use Scripta on the web
            </Link>
            .
          </p>
        </div>
        <div className="flex justify-center">
          <div className="w-56 rounded-[2.5rem] border-2 border-(--color-border) bg-(--color-surface) p-3">
            <div className="overflow-hidden rounded-[2rem] bg-(--color-bg)">
              <div className="flex h-8 items-center justify-center border-b border-(--color-border) text-xs font-bold">
                Scripta
              </div>
              <div className="grid grid-cols-3 gap-1.5 p-2">
                {gridCovers.map((hex, index) => (
                  <div key={index} className="aspect-[2/3] rounded-md" style={{ background: `linear-gradient(160deg, ${hex}, rgba(0,0,0,0.45)), ${hex}` }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
```

(`APP_STORE_URL` / `PLAY_STORE_URL` are `"#"` placeholders until the owner
supplies the test-distribution links — swapping them is the one-line edit
the spec calls for. The phone mock's cover tiles reuse the palette hexes
with a shared dark overlay instead of a per-color dark partner.)

- [ ] **Step 3: Render both**

In `frontend/src/pages/LandingPage.tsx`, add the imports and make `<main>`:

```tsx
      <main>
        <LandingHero />
        <FeatureGrid />
        <MuralShowcase />
        <ArenaShowcase />
        <GetApp />
      </main>
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`
Expected: all pass.

Dev server: duel card above tier rows on mobile (copy first, `order-*`
swaps it on desktop), then the get-the-app band with phone mock and two
ink-colored badges. All four nav anchors scroll to the right sections.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/landing/ArenaShowcase.tsx frontend/src/components/landing/GetApp.tsx frontend/src/pages/LandingPage.tsx
git commit -m "Arena showcase and get-the-app section complete the landing page"
```

---

### Task 8: Full verification

**Files:**
- none (verification only)

**Interfaces:**
- Consumes: everything from Tasks 1–7.

- [ ] **Step 1: Full command gate, in order**

```bash
npm run build --workspace @scripta/shared
npm run typecheck --workspace frontend
npm run lint --workspace frontend
npm test --workspace frontend
npm run build --workspace frontend
```

Expected: every command exits clean. `npm test` includes
`scripts/test-landing.mts` (glob `scripts/test-*.mts` picks it up
automatically — no list to edit; the backend's explicit test list does not
apply here).

- [ ] **Step 2: Visual pass on the dev server**

Per `docs/dev-workflow.md`: check `node scripts/dev-status.mjs --json`
first — if another worktree holds the dev servers, skip this step and rely
on Step 1 plus a later window. Otherwise run the dev servers and verify:

- `/` logged out: nav → hero → features → murals → arena → get-the-app →
  footer, in order, no horizontal scroll at 375px width.
- Signed-in session: `http://localhost:5173/` redirects to `/dashboard`.
- `/login?mode=signup`: **Sign up** tab active, username field visible.
- Both OS themes: text contrast, accent CTAs, white-glyph mark, tier
  colors and cover gradients all readable.
- Emulator/phone capture is optional — skip it unless one is already
  leased; do not take the lease or start an emulator for this.

- [ ] **Step 3: Report**

No commit. Report the verified state: which commands passed, what the
visual pass showed, and that `APP_STORE_URL` / `PLAY_STORE_URL` in
`frontend/src/components/landing/GetApp.tsx` still point at `"#"` pending
the owner's test-distribution links.
