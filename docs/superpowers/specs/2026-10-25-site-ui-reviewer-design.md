# Site UI reviewer — design

## Why

The user feels the website's UI isn't harmonized: page to page it looks and behaves like several products. They want an agent that uses the whole site the way a person would, notices bad UI/UX, and writes a report that says what to standardize on. They also want to know which features exist on only one side, the site or the mobile app.

The site does **not** need to match the app's look. Differences between site and app are fine; incoherence within the site is the problem.

## Goals

- A saved agent, `site-ui-reviewer`, that sweeps every page of the local web app signed in to the fixture account and writes a ranked report with screenshots.
- For each recurring UI pattern, the report lists the variants it found, picks the best one, and recommends it everywhere. This is the user's explicit choice: recommend, don't just list.
- A feature-gap section in both directions (app has, site lacks; site has, app lacks).
- One command that gives a signed-in local website on this worktree's slot, with the fixture library, without the password ever appearing in a transcript.

## Non-goals

- Running the emulator or the mobile app. The gap list comes from the app's code.
- Making the site look like the app, or listing visual differences between them.
- Fixing anything. The agent never edits source, commits or pushes.
- Production. Only the local dev stack.

## Anti-goals

- A report that is a flat list of 80 nitpicks with no direction. Harmony findings must end in a recommendation.
- A review of empty pages because the stack served the wrong database or never signed in. The memory `dev-account-fixture-login` documents both traps; the setup command exists to make them impossible.
- Echoing the fixture password, or putting it in a URL or a log.

## When it runs

Only when the user explicitly asks for a site UI review. Never on the agent's own initiative, and never to verify a change. Same rule as `beta-tester`.

## Parts

### 1. `scripts/dev-web.mjs`

The web counterpart to `dev-emulator.mjs` and `dev-phone.mjs`. It is idempotent:

- claims this worktree's port slot (the same claim path `dev-emulator.mjs` uses),
- builds `@scripta/shared` if needed,
- seeds the dev account and fixture data the same way `dev-emulator.mjs` does (24 books, the published shelf with its mural, the community graph). It must go through `scripts/devFixtureSetup.mjs`. Don't compose `dev-account.mjs` plus `npm run backend` by hand; that pair is the documented wrong-database trap,
- starts the backend with `devDataDirEnv()` and refuses a mismatched adopted backend (`assertAdoptedBackendMatches`),
- sets `ADMIN_USER_ID` (`backend/src/config/env.ts`) on that backend to the fixture user's id, so the admin pages open. This is the user's decision. A backend adopted without that setting is refused like a data-directory mismatch, not reused silently,
- starts Vite on the slot's web port,
- prints the web URL, and as its last stdout line a JSON object that a script can parse: `{"web": "<url>", "api": "<url>"}`.

It takes `--reset`, meaning the same thing as in `dev-emulator.mjs`. `npm run dev:release` stops everything it started.

Calls made while planning, which the builder can revisit with a reason:
- `dev-web.mjs` exits after printing the JSON. The servers stay detached, as with `dev-emulator.mjs`. The slot is registered like any other stack, so it counts toward the limit of 4. It holds no device lease. If `dev:release` assumes a device, fixing that is part of this work.
- The web URL's scheme and host are whatever `npm run frontend` serves on the slot (`dev:claim` writes it into `.claude/launch.json`, currently `https://localhost:<port>`). `dev-web.mjs` generates no certs. If the frontend can't start, it fails with the frontend's error. Pure logic it adds gets `node --test` tests under `scripts/`, like its siblings.

### 2. `scripts/web-snapshot.mjs` (name is the builder's call)

The web counterpart to `dev-snapshot.mjs`, driving Playwright (already a `frontend/` dependency) through installed Google Chrome (`channel: "chrome"`), headless. No Playwright browser download.

- **Sign-in:** the script obtains a session itself and saves Playwright storage state to a file in the output directory. Session lives in `localStorage` (`frontend/src/auth/tokenStore.ts`). How it gets the session (filling the login form with the password read from `scripts/fixtures/account.json` inside the script, or calling the auth API) is the builder's call. The constraint: the credential never goes to stdout, stderr, a file other than the storage state, or a URL. A signed-out mode is also needed, for public pages.
- **Snapshot:** given a path or URL, a viewport width, a name and an output dir, it opens the page, waits for it to settle (network idle plus no layout change), saves a full-page PNG and prints a listing in the spirit of `dev-snapshot.mjs`: the page title and headings, then each interactive element with its role, accessible name (or `(no label)`), size in CSS px, and `⚠ <44px` / `⚠ under <label>` markers. It also prints console errors and failed requests seen during the load.
- **Acting:** the agent has to click, type and open menus. Either the script takes a short list of steps (click by role and name, fill, press, wait for text) before the snapshot, or the agent writes small Playwright scripts. The builder picks whichever keeps the agent's commands short and reliable. Whatever is chosen, the agent must be able to reach states behind a click (sheets, menus, dialogs, editor tabs).
- The dev site serves https with a local cert, so the context ignores HTTPS errors when the dev site is https (Playwright can't scope it per host).
- Service workers are blocked (`serviceWorkers: "block"`), so the PWA's workbox cache can't serve stale pages or keep the network busy (my call).

### 3. `.claude/agents/site-ui-reviewer.md`

Modeled on `.claude/agents/beta-tester.md`: same structure (setup, looking at a page, sweep, what counts as a finding, finish, report template), same never-fix rule, same "append each finding as it's confirmed" discipline. Tools: Bash, Read, Write. Model: Sonnet, like `beta-tester` (my call; switching to Opus for better design judgment is a one-line change).

**Setup.** Run `node scripts/dev-web.mjs --reset` (release first if this worktree already has a stack, as `beta-tester` does). Stop and report if it refuses, for example on the stack limit. Read `DESIGN.md` once; it is the standard for design-system, accessibility and copy findings. Build the coverage list from the routes in `frontend/src/App.tsx` (and `AccountApp.tsx` if it holds routes) and write `report.md` with every route marked "not reached".

**Widths.** Every page at 1280px and at 360px (the user's phone width).

**Sweep.**
1. Signed out: landing, login/signup, privacy, not-found.
2. Signed in as the fixture account: every route, every control used once. Create one of each thing the site makes (mural, collection, tier list, quiz, tournament, share links), so editors and public pages have something to show.
3. Public pages from the share links it created, signed out: shared library, shared mural, vote, play, arena.
4. Admin pages (`/admin/*`): the fixture account is admin under `dev-web.mjs`, so these are reviewed like any other page. Review the UI only, and make no admin decisions that change catalog data beyond what a page needs to show its states.

It never changes the fixture account's password or email and never deletes it. It doesn't clean up what it creates. The run starts from `--reset`, and the report's harness notes say the fixture data is dirty.

**Report: three sections, in this order.**

1. **Harmony.** One finding per pattern: page header, primary/secondary buttons, cards and list rows, spacing and page width, empty / loading / error states, navigation and back, forms and validation, dialogs and sheets, toasts, typography scale. Each finding lists every variant seen (with a page and a screenshot), names the best one with the reason (which follows `DESIGN.md`, reads clearest, is most common), and recommends it for all pages. When `DESIGN.md` already rules on it, the rule wins.
2. **UI/UX problems.** Individual findings, with the `beta-tester` severities (blocker / major / minor / polish) and categories (bug · UX friction · design-system breach · accessibility · copy), steps, expected, actual, screenshot, and width where it matters. One cause on several pages is one finding.
3. **Feature gaps.** Two tables: in the app but not on the site, and on the site but not in the app. Each row has the feature, where it lives (mobile route under `mobile/src/app`, web route), and how central it is to a reader. The app side is read from code: the routes under `mobile/src/app` and what each screen offers (its actions, sheets and menus). The site side is what the sweep actually found, cross-checked against `frontend/src/pages`. A gap claim cites the file it came from.

Then: summary at the top (counts, and the three things to fix first), console errors and failed requests, the coverage table, and harness notes and leftover state.

**Finish.** `npm run dev:release`, whatever happened. Reply with the report's path and its summary.

**Output.** `$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/ui-reviews/<YYYY-MM-DD-HHMM>/`, beside `beta-tests/`. Add `/ui-reviews/` to `.gitignore`.

### 4. `CLAUDE.md`

A row in the subagents table, mirroring `beta-tester`'s: dispatched only when the user explicitly asks for a site UI review; the main session passes its worktree path and the absolute output dir, sends `report.md` with SendUserFile, and then goes through it with the user.

## Constraints

- Reuse `devFixtureSetup.mjs`, `devDataDir.mjs`, the slot claim and `dev-snapshot.mjs`'s listing conventions. Don't make a second copy of "start a signed-in backend".
- Repo rules from `AGENTS.md`: minimum code, no comments, specific error handling. `scripts/` changes are verified by `npm run test:scripts`; `CLAUDE.md` changes by `npm run check:agents`.
- The agent's stack counts toward the shared limit of 4 stacks and must be released at the end.

## Left to the builder

- Name and command-line shape of the snapshot script, and how the agent drives clicks (steps list or ad-hoc scripts).
- How sign-in obtains the session, within the credential constraint above.
- Settle detection details.
- Whether `dev-web.mjs` shares code with `dev-emulator.mjs` beyond `devFixtureSetup.mjs`, for example by extracting the slot and seed steps.
