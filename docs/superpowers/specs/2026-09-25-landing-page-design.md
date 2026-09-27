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
buttons. No theme switch — like every other screen, the page styles through
the same `--color-*` token classes, so it follows the OS light/dark
preference automatically and both palettes come free; the one token the page
needs that `index.css` doesn't have yet is DESIGN.md's `on-accent` (CTA
label color), added to both theme blocks. The nav/footer mark is
`icon-512.png` (white glyph on dark square) — the only brand asset readable
in both themes; `logo.png`/`scriptap.png` are dark-ink-on-transparent. Type:
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
- `frontend/src/lib/landing.ts` — both pure helpers (`landingDestination`,
  `modeFromSearch`) in one importable module. Not inside the components:
  node:test can't import a page module (`import.meta.env` access at module
  load — the same reason `test-baseUrl.mts` tests `resolveApiUrl.ts` rather
  than `baseUrl.ts`).
- `frontend/scripts/test-landing.mts` — new test file, added to the `npm
  test` glob automatically (`scripts/test-*.mts`)

## Error handling

The page has no data fetching and no forms — nothing to swallow. CTAs are
plain anchors/`Link`s; store badges are external anchors with
`rel="noreferrer"` and aria-labels. The only stateful logic — the
logged-in redirect decision and the LoginPage param parse — lives in
`src/lib/landing.ts` as exported pure functions, so the components stay
trivial and the branches are unit-testable.

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

## Revision, 2026-09-27

Reworked after two design reviews, towards a quieter, more serious page.
Where this section and the ones above disagree, this one describes the code.

- **Name**: Atmyshelf everywhere, with the app sidebar's icon-and-name
  lockup (`components/BrandLockup.tsx`) in the landing nav and footer and
  on every auth screen.
- **One story**: hero → How it works (bring your books, make it yours,
  share your reading life) → Sharing (murals, plus reader cards labelled
  "Coming soon", since neither client ships them yet) → Games (the
  tournament and tier-list demos in one section, behind a switch) →
  Start your library → footer.
- **Hero**: real screenshots of the app (a demo library on the three-user
  fixture backend) in `public/landing/`, light and dark variants picked by
  `prefers-color-scheme`; the desktop library view with the phone home
  screen beside it, the phone view alone below `sm`.
- **Honest availability**: no store badges until there are store links;
  the closing section says the iPhone and Android apps are in beta.
- **Type**: Playfair Display at its real 400 weight (`font-display`) for
  the hero and section headings only; everything else in the system sans.
  No uppercase eyebrow labels.
- **Auth screens** (`auth/AuthStage.tsx`): the same theme tokens as the
  app, following the OS light/dark preference, instead of the fixed dark
  cover stage; log in / sign up switch by a link under the form instead of
  tabs; Google as a secondary "Continue with Google" button.
