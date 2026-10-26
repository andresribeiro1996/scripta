# Web game tickets

## Why

PR #331 (merged 2026-10-24, live) gave the mobile app roomy "ticket" cards for tier lists, tournaments and quizzes. Each card has per-type artwork, theme tints, a quiz clue from a real question, grouped stats and an action footer. The site still shows the old cramped rows on Discover and plain text cards on the Games dashboard. The user wants the site to match.

## Goals

- One web ticket component used by Discover (`/community/discover` and the public `/arena`) and by every card on the Games dashboard (`ArenaListPage`: tournaments created/voting, tier lists created/voted, quizzes).
- Visual parity with `mobile/src/features/community/DiscoverRow.tsx` (`GameRow`) and `GameTicketArt.tsx`:
  - left art panel tinted with the kind's soft colour;
  - name, creator row and status badges;
  - grouped stats (value above label) behind a top border, omitted when empty;
  - a full-width quiz clue section for non-cover previews;
  - a dashed footer with notches and a tinted primary action.
- Shared logic lives in `@scripta/shared`: `gameActionLabel` and `TIER_LADDER` move there from `mobile/src/features/community/communityHome.ts`.

## Non-goals

- The profile page's "Published" grid stays as it is. Mobile's profile also kept plain rows.
- No web Search page, no Top Shelf and no "See books" preview sheet. Web has none of these today.
- No backend change. `QuizSummary.preview` already reaches the web client (`packages/shared/src/community/types.ts:52`).
- Own tier lists on the dashboard show the tier-colour ladder only, with no cover fan. Mobile gets those covers from the full library (`tierlistCovers`). The dashboard doesn't load the library today, and these cards aren't worth adding that fetch for.

## Anti-goals

- No fixed colours. Tints come from theme variables, so all 11 palettes work. The tier ladder keeps `DEFAULT_TIER_PRESET` colours, as mobile does.
- No answer key or choices on screen. Show only `preview.prompt`.
- No loss of the existing dashboard behaviour: inline rename for draft tier lists, Delete via `OptionsMenu` with confirm, a seeding tournament linking to `/dashboard/arena/:id/seed`, and keyboard access.

## Design decisions (made by Claude; the user skipped the questions)

- **Tints.** Quiz uses `--color-reference` / `--color-reference-soft`, tier list `--color-success` / `--color-success-soft`, tournament `--color-accent` / `--color-accent-soft`. This is the same mapping as mobile `GameRow`, `DiscoverRow.tsx:80-82`.
- **Layout.**
  - Discover moves from a `<ul>` list to the dashboard's grid: `grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3`.
  - The ticket is a card: `relative flex flex-col rounded-xl border border-(--color-border) bg-(--color-surface) overflow-hidden hover:border-(--color-accent)`.
    - `relative` scopes the stretched title link to the card; without it the link covers the whole grid.
    - The hover border is the dashboard cards' existing hover.
    - The footer is `mt-auto relative z-10`, so footers line up across a grid row and its controls sit above the stretched link.
  - The art panel is 88px wide with a right border. The details column has `p-4`.
- **Links.**
  - The title is a `Link` with a stretched `after:absolute after:inset-0` hit area, the pattern `DiscoverRow` uses today.
  - The link starts with an `sr-only` kind prefix ("Tier list: ", "Tournament: ", "Quiz: "), because the art is `aria-hidden` and the visible kind label goes away. Mobile does the same in its accessibility label, `DiscoverRow.tsx:87`.
  - The creator link and footer controls sit above it with `relative z-10`.
  - The footer primary action is a second `Link` to the same target, labelled `` `${actionLabel}: ${name}` `` for screen readers. It shows the action label and a chevron.
- **Action labels.** Discover uses `gameActionLabel(content)`. Dashboard cards use "Open game", the default mobile owned rows get from `GameRow`.
- **Status.** The component takes `badges: ReactNode`.
  - Discover renders `StatusBadge` from `contentStatus`, plus a "Voted" info badge when `votedBadge` is set (mobile parity).
  - The dashboard keeps passing `TournamentStatusBadge` / `QuizStatusBadge` as it does now.
  - Own tier lists pass no badge, as today.
- **Creator row.** Discover shows `AuthorAvatar` (`components/CommunityAuthorAvatar.tsx`, size 28), a semibold username link to `/community/u/:username` (plain text when `author.unavailable`) and `ReaderGlyph`. The dashboard passes its existing subline as plain dim text (meta string).
- **Art.** Port `GameTicketArt.tsx` to DOM, with all art `aria-hidden`:
  - Quiz with a `cover_title` preview: the cover with `filter: blur(6px)`, inside a rounded `overflow-hidden` 54×80 box tilted -6° so the blurred edge doesn't bleed, with a "?" overlay.
  - Quiz with another preview type: `LibraryIcon` for `title_cover`, otherwise `QuoteIcon` (both in `frontend/src/components/NavIcons.tsx`), in the kind colour.
  - Quiz with no preview: "?".
  - Every quiz panel also shows a row of A/B/C chips.
  - Tournament: two covers tilted ±7° with "VS" between them.
  - Tier list: up to 5 ladder bars of decreasing width, plus a fan of up to 3 tilted covers. A list with no covers shows a single placeholder cover.
  - Covers stay plain `<img src loading="lazy" alt="">`, as on Discover today.
- **Clue.** Shown for a quiz `preview` whose type isn't `cover_title`.
  - Heading: the same icon (with `aria-hidden="true"`, which `svgProps` in `NavIcons.tsx:23` doesn't set) plus `quizClueHeading(type)`.
  - Body: `preview.prompt` clamped to 3 lines (`line-clamp-3`).
  - Styling: `bg-(--color-bg)`, a 2px left border, `rounded-lg`, in a full-width section below the header row.
- **Footer.**
  - Dashed top border, plus two 14px notch circles in the page background colour at the top-left and top-right edges.
  - The primary action has the soft tint background and kind-colour text, with hover `bg-(--color-accent-fill) text-(--color-text)` for contrast (mobile does the same when pressed, `DiscoverRow.tsx:134`). It ends with `ChevronRightIcon` from `frontend/src/components/Toolbar.tsx`.
  - An optional `menu: ReactNode` slot holds the dashboard `OptionsMenu`.

## Tasks

### Task 1: Move `gameActionLabel` and `TIER_LADDER` to shared

Files:
- Modify: `packages/shared/src/community/helpers.ts`
- Test: `packages/shared/src/community/helpers.test.ts`
- Modify: `mobile/src/features/community/communityHome.ts`
- Modify: `mobile/src/features/community/communityHome.test.ts`

Steps:
1. Move both exports verbatim into `packages/shared/src/community/helpers.ts`.
   - `TIER_LADDER = DEFAULT_TIER_PRESET.map((tier) => tier.color)`, with `import { DEFAULT_TIER_PRESET } from "../tierlists/tierlist.js"`.
2. Move the `gameActionLabel` assertions into the shared test.
   - Copy the `tierlist`/`tournament`/`quiz` fixtures from `communityHome.test.ts:31-50` into the shared test under new names. Copy, don't move: other mobile tests still use them, and the shared test's `quiz` is already a factory (`helpers.test.ts:77`).
   - Drop `gameActionLabel` from the mobile test's import.
3. In mobile `communityHome.ts`, re-export both from `@scripta/shared/community` alongside the existing re-exports. This keeps mobile import sites untouched. Remove the now-unused `DEFAULT_TIER_PRESET` and `PublishedContent` imports.
4. Run the build, test and typecheck commands in `packages/AGENTS.md` and `mobile/AGENTS.md`.

### Task 2: Web `GameTicket` component

Files:
- Create: `frontend/src/components/games/GameTicket.tsx`
- Create: `frontend/src/components/games/GameTicketArt.tsx`
- Test: `frontend/scripts/test-game-ticket.mts`

Props:
- `kind`, `name`, `to` (target path), `meta: ReactNode`, `badges: ReactNode`;
- `stats?: Array<{ value: number; label: string }>`;
- `covers: string[]`, `ladder?: string[]`, `preview?: QuizPreview`;
- `actionLabel?: string` (default "Open game"), `menu?: ReactNode`.

Also export a `StatusBadge({ label, tone })` that holds the `STATUS_TONES` map, moved from `DiscoverPage.tsx`.

Tests use `renderToString` with `createElement` (`.mts` can't hold JSX) inside a `MemoryRouter`, as `test-phone-layout.mts` does. Assert that:
- each kind's art panel uses its soft variable (`--color-reference-soft`, `--color-success-soft`, `--color-accent-soft`);
- a `quote_title` preview renders the clue section with `quizClueHeading` text and the prompt;
- a `cover_title` preview renders a blurred `<img>` and no clue section;
- no stats means no stats divider;
- the footer link carries `` `${actionLabel}: ${name}` `` and points at `to`;
- the A/B/C chips render for a quiz;
- the title link carries the `sr-only` kind prefix.

### Task 3: Discover renders tickets

Files:
- Modify: `frontend/src/pages/DiscoverPage.tsx`

Steps:
1. Replace the local `DiscoverRow`, the `TierlistThumb` / `TournamentThumb` / `QuizThumb` / `Cover` components, the thumb constants and `STATUS_TONES` with `GameTicket`, using the props from the design decisions.
2. Pass `ladder={TIER_LADDER}` for tier lists, `preview` for quizzes and `stats={contentStats(content)}`.
3. Keep the `<ul>`/`<li>` semantics, with the grid classes on the `<ul>`, and drop its `border-t`.
4. Give `SkeletonCardGrid` `tileClassName="min-h-[260px]"` and `gridClassName` with the same `gap-3` grid. Its default is `gap-4`, `Skeleton.tsx:55`.
5. Remove the imports that become unused (`DEFAULT_TIER_PRESET`, `CSSProperties`, `contentKindLabel`). Typecheck has `noUnusedLocals`.

### Task 4: Games dashboard renders tickets

Files:
- Modify: `frontend/src/pages/ArenaListPage.tsx`

Card mapping:

| Card | Target | Meta | Badge | Covers / art |
|---|---|---|---|---|
| Tournament (`TournamentCard`) | unchanged | `${bracketSize}-book bracket` | `TournamentStatusBadge` | `t.covers` |
| Own tier list | `/dashboard/arena/tierlist/:id` | "Updated …" | none | `ladder={tl.data.tiers.map((tier) => tier.color)}`, `covers={[]}` |
| Voted tier list | `contentTarget(...)` | `contentDetail(...)` | none | `tl.covers`, `TIER_LADDER` |
| Quiz | `/dashboard/arena/quiz/:id` | `${n} books` | `QuizStatusBadge` | `covers={[]}` (quiz art ignores covers), `preview={quizPreview(quiz.data)}` |

Steps:
1. Replace each card with `GameTicket` using the mapping above.
2. Move each `OptionsMenu` into the `menu` slot, so its trigger is no longer absolutely positioned.
3. Keep the inline rename editor exactly as is while renaming.
4. Drop the `role="button"` div wrappers and their `onKeyDown`; links now carry navigation. Keep `useNavigate`: `handleCreate` and the create buttons still use it.
5. Grow the three dashboard skeletons from `min-h-[86px]` to `min-h-[260px]`.

### Task 5: Verify

- Run `node scripts/gate.mjs` before committing; it only sees uncommitted changes. Once work is committed, run the Verify commands from `frontend/`, `mobile/` and `packages/` `AGENTS.md` directly.
- Start the stack per `docs/dev-workflow.md` and seed the dev account with `node --import tsx scripts/dev-account.mjs`. Then use `preview_start` on the `api` and `web` entries of `.claude/launch.json`.
  - Sign in as `scripta-dev@local.test`. Get the password with exactly `node -e 'process.stdout.write(require("./scripts/fixtures/account.json").password)'` from the worktree root, and never echo it.
  - Before signing in, check the backend's listening port against `.claude/launch.json` and `frontend/.env.local`, because slots can drift.
  - If Discover is empty, publish a fixture quiz and tier list from the dashboard first.
- Screenshot Discover and each dashboard tab at 360px and 1280px, in light and dark, and in one further palette.
- Check for:
  - no horizontal scroll;
  - the stretched title link doesn't swallow the creator link or menu;
  - the menu opens;
  - Delete and confirm still work;
  - rename still works on a draft tier list.
- No device pass: mobile only changes imports.
