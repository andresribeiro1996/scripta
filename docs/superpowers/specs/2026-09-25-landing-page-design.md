# Marketing landing page at `/`

## Context

Scripta (atmyshelf.com) has no marketing surface: `/` redirects straight to
`/dashboard`, which bounces strangers to `/login`. The app is moving to a
hosted, sign-up model, and the owner wants a landing page that (a) onboards
new users and (b) works as a portfolio piece. The mobile app (Expo) is still
in test distribution — no store listings yet.

Decided against: a standalone static page at the root (the install prompt and
real signup live in the app's origin; a static page could only deep-link), and
a separate mini-project (one more build to maintain for no gain).

## Decisions locked in with the user

- **The page is a route inside `frontend/`, served at `/`.** Logged-out
  visitors get the landing; a signed-in visitor hitting `/` still goes to
  `/dashboard`. One deploy, reuses the app's Tailwind tokens and logo.
- **Sign up links to `/login?mode=signup`** — the real form with Google
  OAuth, not an embedded duplicate. `LoginPage` gets a one-line change: its
  segmented login/signup toggle initializes from the `mode` query param
  (defaults to `login`).
- **"Get the app" = store badges** pointing at the current test distribution
  (plain anchor, easy to swap to real store URLs when it ships), plus a
  "use it in the browser" link for the web app. The page does not touch PWA
  install flows.
- **Visuals are CSS-built mockups** styled after the real components
  (`BookCard` grid, mural blocks, `DuelCard`, tier rows) — no screenshot
  assets, always crisp, swappable for real screenshots later.
- **Purpose is onboarding + portfolio showcase.** Tone: short, confident,
  product-like; positioning is "your reading history, in a library that's
  yours" (Kobo/Goodreads import is the hook).

## Routing

`App.tsx`: replace the unconditional `/` → `/dashboard` redirect with an
element that checks the session — session present → `<Navigate to="/dashboard"
replace />`, otherwise → `<LandingPage />`. Sits outside every
`RequireAuth`/`RequireUsername` wrapper, same tier as `/login` and the
`/shared/*` public pages.

## Page anatomy (single scroll)

1. **Nav** (sticky, `bg` + `border` hairline): logo lockup
   (`frontend/public/logo.png`), anchor links — Features · Murals · Arena ·
   Get the app — and a Sign in button (`/login`).
2. **Hero**: headline + subline about importing Kobo and Goodreads history;
   primary CTA "Create your library" → `/login?mode=signup`; secondary link
   "See how it works" → `#features` anchor. Visual: fanned CSS book-card
   grid — rounded covers (`radius-xl`), title/author overlay, Playfair
   Display variant, subtle stagger/rotation, `prefers-reduced-motion` safe.
3. **Features** (`#features`): six `surface` cards with hand-authored inline
   SVG icons (24 viewBox, stroke `currentColor`, 1.9–2, round caps — per
   DESIGN.md): Kobo & Goodreads import · styled card library · series &
   collections · public share links · web app (installable) · mobile app.
4. **Murals** (`#murals`): its own band — the differentiator. CSS mockup of a
   mural: `shelf` row, `quote` block, `stats` block on bordered `surface`
   cards, mirroring `MuralBlock` chrome (`radius-lg`/`border`/`surface`).
5. **Arena** (`#arena`): CSS mockup of a `DuelCard` (2px borders, `accent`
   tally bar) beside default tier rows (S/A/B/C/D preset colors).
6. **Get the app** (`#app`): CSS phone mockup + two store badges + "use it
   in the browser" link. Badge URLs are module constants in `GetApp.tsx`
   (App Store / Google Play), placeholder `"#"` until the owner supplies
   the real test-distribution links — swapping them is a one-line edit.
7. **Footer**: monogram (`scriptap.png`), one-line description, minimal links
   (web app, sign in). No fake links.

## Visual language

Byte-identical to the DESIGN.md tokens already in `frontend/src/index.css`:
`bg #f5f4f2` page, `surface` cards, `text`/`text-dim`, `accent #a85c32`
single primary action, `border` hairlines, `radius-xl` covers, `radius-md`
buttons. Light theme only — the marketing page has no theme switch. Type:
system stack everywhere except the hero display line, which uses the
already-self-hosted Playfair Display from `frontend/public/fonts/`. Motion:
existing 130–200ms `cubic-bezier(0.32, 0.72, 0, 1)` on hover/entrance,
snapped off under `prefers-reduced-motion`. No new colors, radii, or
breakpoints (stock Tailwind `sm`/`md`/`lg`).

## Files

- `frontend/src/pages/LandingPage.tsx` — composition of the sections
- `frontend/src/components/landing/` — `LandingNav`, `LandingHero`,
  `FeatureGrid`, `MuralShowcase`, `ArenaShowcase`, `GetApp`,
  `LandingFooter` (section content stays inline in these; no copy/config
  indirection)
- `frontend/src/pages/LoginPage.tsx` — initialize mode from `?mode=`
- `frontend/src/App.tsx` — the `/` route change
- `frontend/scripts/test-landing.mts` — new test file, added to the `npm
  test` glob automatically (`scripts/test-*.mts`)

## Error handling

The page has no data fetching and no forms — nothing to swallow. CTAs are
plain anchors/`Link`s; store badges are external anchors with
`rel="noreferrer"` and aria-labels. The only stateful logic is the
logged-in redirect decision, which lives in a small exported pure helper
(`landingDestination(session)` in `LandingPage.tsx`) so the route element
stays trivial and the branch is unit-testable. The same trick pins the
LoginPage param parse: an exported `modeFromSearch(params)` next to the
component.

## Testing & verification

- `frontend/scripts/test-landing.mts` (node:test, repo pattern): the
  redirect helper — no session → landing, session → `/dashboard`; and the
  LoginPage mode-param parse (`?mode=signup` → signup, absent/garbage →
  login).
- `npm run build --workspace @scripta/shared`, then
  `npm run typecheck --workspace frontend`, `npm run lint`, `npm test`,
  `npm run build --workspace frontend`.
- Visual check on the dev server (desktop + phone width) before calling it
  done.

## Out of scope

Embedded signup form on the landing page; dark-mode variant; analytics;
multi-page marketing site; automating the badge-URL swap when the app ships
to stores.
