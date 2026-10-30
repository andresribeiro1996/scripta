# Desktop Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the web app's desktop frame and page layouts with the revamp design: a sticky top bar, one page header, three page widths, desktop compositions per page, and one of each control.

**Architecture:** Phase 1 changes the shared frame (`DashboardLayout`, `PublicLayout`, `Page`) and the shared control classes, so every page moves to the new header in one PR. Phases 2–5 recompose pages area by area on top of it. Phase 6 sweeps what's left and rewrites the docs. Each phase is one PR, except Home, which is two (3a and 3b).

**Tech Stack:** React 19, React Router, Tailwind v4 (no config file; `bg-(--color-…)` form), TypeScript. Tests are `node:test` with `react-dom/server` and regex or source assertions (`frontend/scripts/test-*.mts`), plus `packages/shared` tests.

**Spec:** `docs/superpowers/specs/2026-10-29-desktop-revamp-design.md`. Mockup sources are in `docs/superpowers/specs/2026-10-29-desktop-revamp-mockups/` (the canvas is https://claude.ai/artifact/8i4a5Kt22ny6DeyHaqwcow). Read the spec first; this plan argues from it.

## Global Constraints

- No token, palette, font, decor or brand changes (`packages/shared/src/themes/` untouched). The cover shadow is the only addition, and it is web-only.
- Every control is at least 44px (`min-h-11` / `h-11 w-11`). One primary (`BUTTON_PRIMARY`) per view.
- Routes, `?tab=`, `?status=`, `?sort=`, `?action=` and share-link formats are unchanged.
- The owner's library style (card style, `contentMaxWidth`, canvas background) still applies to the Library grid, Series, Collections and the shared library only.
- Below `lg` (1024px) the bottom bar and More drawer stay the navigation, and `setNavHidden` keeps working.
- Page widths are `wide` 1440 (or the owner's width via `maxWidth` on library pages), `default` 1200 and `narrow` 760. Gutters are `px-4 sm:px-6 lg:px-8`.
- Sentence case. Copy for the area is "Games", never "Arena".
- Repo rules: minimum code, reuse `@scripta/shared`, no comments in code, no new dependencies, and catch only specific failures.
- Tests that pin today's frame are rewritten to assert the new rule, never deleted.
- **Navigation:** the user chose the top bar over a sticky sidebar (2026-10-30).

## Review Focus

1. **Long text**: a 30-character username, a 120-character book title, a library name of 60 characters. Wrap or truncate, with no horizontal page scroll. Tests are in Task 2 (menu heading truncates), Task 3 (`h1` breaks words) and Task 7 (the library-name control wraps).
2. **The narrowest desktop, 1024px**: brand, six area links and the account button fit on one line of the top bar. Task 2 tightens the spacing below `xl`, and its browser check measures this at 1024px.
3. **Dark-scheme and decor themes** (Dark, Midnight, Synthwave, Oxblood): the translucent bar stays legible and covers use the dark shadow. Task 1 tests the dark override exists. Each phase's browser pass includes Synthwave or Oxblood.
4. **Keyboard and screen reader**: the skip link, the current area or tab announced, chip state announced, the account menu reachable by keyboard. Tests are in Tasks 2, 3 and 7.
5. **Who sees which frame**: a signed-in reader with a username opens `/vote/:code` and gets the app frame; one without a username, or signed out, gets the public bar; and the owner's width of 800 or 1800 still lines the Library header up with its grid. Tests are in Tasks 3 and 4.

## Running the work

- **Phases are PRs.** Phase 1 ships from `claude/desktop-ui-ux-revamp-9d9996`, which already holds the spec and this plan. Each later phase branches from up-to-date `main` after the previous PR merges. If it has to start earlier, stack it and retarget to `main` before `gh pr merge --merge --auto`, because auto-merge on a stacked PR skips CI.
- **Per task:** the `implementer` agent, then `spec-reviewer`, then `quality-reviewer`. At most 3 implement-and-review rounds.
- **Per phase, before merge:** `branch-reviewer` with the spec and plan, plus `node scripts/codex-review.mjs branch docs/superpowers/specs/2026-10-29-desktop-revamp-design.md docs/superpowers/plans/2026-10-29-desktop-revamp.md` in the background.
- **Verify, every task:** `npm run build --workspace @scripta/shared && npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`. Add `npm test --workspace packages/shared` when shared changes.
- **Browser pass per phase (main session):**
  - Start the site with `node scripts/dev-web.mjs`. Its last line prints the URLs.
  - Sign in as `scripta_dev`. Get the password with `node -e 'process.stdout.write(require("./scripts/fixtures/account.json").password)'` and never echo it.
  - Check the phase's pages at 1440×900, 1280×800, 1024×768 and 390×844, in Light, Dark and Synthwave. Screenshots go in the PR.
  - `npm run dev:release` when done.
- Run a single frontend test with `npm exec --workspace frontend -- tsx --tsconfig tsconfig.app.json --test scripts/test-<name>.mts`. Without the tsconfig, render tests throw `React is not defined`. Shared tests run with `npm test --workspace packages/shared`.
- Every regex in these tests that walks a JSX tag's attributes uses `(?:[^>]|=>)*`, not `[^>]*`, because an inline arrow function (`onChange={(e) => …}`) contains a `>`.

---

## Phase 1 — Frame (PR 1)

### Task 1: Control and surface classes, layout variables

**Files:**
- Modify: `frontend/src/components/page/buttonClasses.ts`
- Create: `frontend/src/components/page/surfaceClasses.ts`
- Modify: `frontend/src/components/Toolbar.tsx`
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/components/ConfirmDialog.tsx`
- Modify: `frontend/src/auth/DeleteAccountSection.tsx`
- Modify: `frontend/src/pages/LibraryPage.tsx`
- Modify: `frontend/src/pages/GroupsPage.tsx`
- Modify: `frontend/src/components/OwnShelfView.tsx`
- Modify: `frontend/src/pages/ArenaListPage.tsx`
- Modify: `frontend/src/pages/MuralsListPage.tsx`
- Modify: `frontend/src/components/LibraryToolbar.tsx`
- Modify: `frontend/src/components/arena/BracketTree.tsx`
- Test: `frontend/scripts/test-controls.mts`

**Interfaces:**
- Produces in `buttonClasses.ts`: `BUTTON_PRIMARY` and `BUTTON_SECONDARY` (unchanged), plus:
  - `BUTTON_DANGER` (filled `danger`, `on-danger` text)
  - `BUTTON_DANGER_OUTLINE` (`danger` border and text, transparent)
  - `FIELD_CLASS` (text inputs, selects, textareas)
  - `chipClass(selected: boolean): string`
- Produces in `surfaceClasses.ts`:
  - `PANEL = "rounded-xl border border-(--color-border) bg-(--color-surface)"`
  - `LIST_PANEL` (PANEL plus `divide-y divide-(--color-border) overflow-hidden`)
  - `LIST_ROW = "flex min-h-11 items-center gap-3 px-4 py-3"`
  - `LIST_ROW_LINK` (LIST_ROW plus `hover:bg-(--color-surface-hover)`)
  - `SECTION_HEADING = "font-display text-2xl font-bold"`
  - `PANEL_HEADING = "font-text text-base font-bold"`
- Produces in `index.css`:
  - the custom property `--app-top`: `0px`, and `4rem` from `min-width: 64rem`;
  - `html { scroll-padding-top: var(--app-top) }`;
  - `--shadow-cover`: light value `0 1px 2px rgb(32 30 28 / 0.2), 0 12px 24px -12px rgb(32 30 28 / 0.5)`, overridden for dark-scheme themes (use the selector the `dark:` custom variant uses, `frontend/src/themes.css:3`) to `0 1px 2px rgb(0 0 0 / 0.6), 0 14px 28px -12px rgb(0 0 0 / 0.9)`;
  - a `[data-top-bar]` rule under `@media (prefers-reduced-transparency: reduce)` setting `background: var(--color-bg); backdrop-filter: none`.
- `TOOLBAR_CONTROL_CLASS` is deleted. Its users take `FIELD_CLASS`.

- [ ] **Step 1: Write the failing tests** (append to `test-controls.mts`)

```ts
import { BUTTON_DANGER, BUTTON_DANGER_OUTLINE, FIELD_CLASS, chipClass } from "../src/components/page/buttonClasses";
import { LIST_PANEL, LIST_ROW_LINK, PANEL_HEADING, SECTION_HEADING } from "../src/components/page/surfaceClasses";

test("danger buttons meet the floor and pair danger with on-danger", () => {
  assert.match(BUTTON_DANGER, /min-h-11/);
  assert.match(BUTTON_DANGER, /bg-\(--color-danger\)/);
  assert.match(BUTTON_DANGER, /text-\(--color-on-danger\)/);
  assert.match(BUTTON_DANGER_OUTLINE, /border-\(--color-danger\)[^"]*text-\(--color-danger\)|text-\(--color-danger\)[^"]*border-\(--color-danger\)/);
});

test("one field class: 44px, 16px text, accent focus, danger when invalid", () => {
  for (const cls of [/min-h-11/, /text-base/, /rounded-lg/, /border-\(--color-border\)/, /bg-\(--color-surface\)/, /focus:border-\(--color-accent\)/, /aria-invalid:border-\(--color-danger\)/]) assert.match(FIELD_CLASS, cls);
});

test("filter chips: 44px pills, inverted ink when selected", () => {
  assert.match(chipClass(true), /min-h-11[^"]*rounded-full|rounded-full[^"]*min-h-11/);
  assert.match(chipClass(true), /bg-\(--color-text\)[^"]*text-\(--color-bg\)/);
  assert.match(chipClass(false), /bg-\(--color-surface\)/);
  assert.match(chipClass(false), /border-\(--color-border\)/);
});

test("lists are one panel with divided rows, headings have two styles", () => {
  assert.match(LIST_PANEL, /divide-y divide-\(--color-border\)/);
  assert.match(LIST_ROW_LINK, /min-h-11/);
  assert.match(SECTION_HEADING, /font-display/);
  assert.match(PANEL_HEADING, /font-text/);
});

test("no hand-rolled danger fills and no toolbar field class", () => {
  for (const f of ["components/ConfirmDialog", "auth/DeleteAccountSection", "pages/LibraryPage", "pages/GroupsPage", "components/OwnShelfView"]) assert.doesNotMatch(src(f), /bg-\(--color-danger\)/, f);
  assert.doesNotMatch(src("components/Toolbar"), /TOOLBAR_CONTROL_CLASS/);
});

test("layout variables: sticky offset, scroll padding, cover shadow in both schemes, solid bar for reduced transparency", () => {
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  assert.match(css, /--app-top:\s*0(px)?/);
  assert.match(css, /min-width:\s*64rem[\s\S]*?--app-top:\s*4rem/);
  assert.match(css, /scroll-padding-top:\s*var\(--app-top\)/);
  assert.equal(css.match(/--shadow-cover:/g)?.length, 2);
  assert.match(css, /prefers-reduced-transparency:\s*reduce[\s\S]*?\[data-top-bar\]/);
});
```

- [ ] **Step 2: Run** the file. Expected: FAIL, because the imports don't exist.
- [ ] **Step 3: Implement.**
  - Add the constants and `chipClass`, using `BUTTON_PRIMARY`'s `BOX` for both danger variants. `FIELD_CLASS` is `min-h-11 rounded-lg border border-(--color-border) bg-(--color-surface) px-3 text-base text-(--color-text) placeholder:text-(--color-text-dim) focus:border-(--color-accent) aria-invalid:border-(--color-danger) disabled:opacity-55`.
    - It carries no width. Callers add `w-full` where a field fills its row, because appending a competing width class doesn't reliably win (see the specificity note above `TOOLBAR_ICON_BUTTON_CLASS`).
    - It carries no `outline-none`, so the global `*:focus-visible` ring (`index.css:128`) still shows.
  - `chipClass` is `inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold` plus, when selected, `border-(--color-text) bg-(--color-text) text-(--color-bg)`, and otherwise `border-(--color-border) bg-(--color-surface) text-(--color-text) hover:bg-(--color-surface-hover)`.
  - Swap the five danger fills (`ConfirmDialog.tsx:79`, `DeleteAccountSection.tsx:41`, `LibraryPage.tsx:365`, `GroupsPage.tsx:324`, `OwnShelfView.tsx:385`) to `BUTTON_DANGER`, keeping any width utilities they had.
  - Replace `TOOLBAR_CONTROL_CLASS` at its 8 sites with `FIELD_CLASS`.
  - Add the CSS.
- [ ] **Step 4: Run** the test, then the Verify line. Expected: all PASS.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/page/buttonClasses.ts frontend/src/components/page/surfaceClasses.ts frontend/src/components/Toolbar.tsx frontend/src/index.css frontend/src/components/ConfirmDialog.tsx frontend/src/auth/DeleteAccountSection.tsx frontend/src/pages/LibraryPage.tsx frontend/src/pages/GroupsPage.tsx frontend/src/components/OwnShelfView.tsx frontend/src/pages/ArenaListPage.tsx frontend/src/pages/MuralsListPage.tsx frontend/src/components/LibraryToolbar.tsx frontend/src/components/arena/BracketTree.tsx frontend/scripts/test-controls.mts && git commit -m "Add the shared danger, field, chip and panel classes"
```

### Task 2: Top bar and account menu replace the sidebar

**Files:**
- Create: `frontend/src/components/page/TopBar.tsx`
- Create: `frontend/src/components/page/AccountMenu.tsx`
- Modify: `frontend/src/components/OptionsMenu.tsx`
- Modify: `frontend/src/components/Toolbar.tsx`
- Modify: `frontend/src/lib/areas.ts`
- Modify: `frontend/src/layouts/DashboardLayout.tsx`
- Modify: `frontend/src/components/OfflineBanner.tsx`
- Modify: `frontend/src/components/SwipeTabs.tsx`
- Modify: `frontend/src/pages/MuralEditorPage.tsx`
- Modify: `frontend/src/pages/SharedMuralPage.tsx`
- Modify: `frontend/src/pages/ReaderCardPage.tsx`
- Modify: `frontend/src/components/book/BookScreen.tsx`
- Create: `frontend/scripts/test-top-bar.mts`
- Test: `frontend/scripts/test-areas.mts`

**Interfaces:**
- Consumes: `NAV_AREAS`, `areaIdForPath`, `footerAreas` (`areas.ts`); `OptionsMenu`, `OptionsMenuItem`; `Avatar`; `BrandLockup`; the existing `ChevronDownIcon` (`Toolbar.tsx:226`); `newCountLabel` (`@scripta/shared`); `--app-top` (Task 1).
- Produces:
  - `TOP_BAR_AREAS: readonly Area[]`, which is `NAV_AREAS` without `settings`.
  - `TopBar(props: { areas: readonly Area[]; activeId: AreaId | null; homeBadge?: string | null; brandTo: string; end: ReactNode; desktopOnly?: boolean }): JSX.Element`.
  - `accountMenuItems(input: { username: string; isAdmin: boolean; navigate: (to: string) => void; logout: () => void }): OptionsMenuItem[]`.
  - `AccountMenu(props: { user: SessionUser; isAdmin: boolean; active: boolean; onLogout: () => void }): JSX.Element`. `SessionUser` is the type of `session.user`.
  - A new optional prop on OptionsMenu: `heading?: string`.

- [ ] **Step 1: Write the failing tests** (`test-top-bar.mts`, following `test-sidebar-nav.mts`'s imports and `MemoryRouter` render; plus the `test-areas.mts` addition)

```ts
const bar = (props: Partial<Parameters<typeof TopBar>[0]> = {}) => renderToString(createElement(MemoryRouter, null,
  createElement(TopBar, { areas: TOP_BAR_AREAS, activeId: "library", brandTo: "/dashboard", end: createElement("span", null, "END"), ...props })));

test("a 64px bar, sticky from lg, skip link first, then the brand", () => {
  const html = bar();
  assert.match(html, /<header(?=[^>]*data-top-bar)(?=[^>]*lg:sticky lg:top-0)[^>]*>/);
  assert.match(html, /h-16/);
  assert.match(html, /^<header[^>]*><a href="#content"[^>]*sr-only[^>]*focus:not-sr-only[^>]*>Skip to content<\/a>/);
  assert.match(html, /href="\/dashboard"/);
});

test("six areas as 44px pills, the current one marked", () => {
  const html = bar();
  const nav = html.match(/<nav aria-label="Main"[\s\S]*?<\/nav>/)![0];
  assert.equal(nav.match(/<a(?=[^>]*min-h-11)(?=[^>]*rounded-full)[^>]*>/g)?.length, 6);
  assert.doesNotMatch(nav, /Settings|Admin/);
  assert.match(nav, /<a(?=[^>]*aria-current="page")(?=[^>]*href="\/dashboard\/library")[^>]*>/);
  assert.equal(nav.match(/aria-current="page"/g)?.length, 1);
});

test("the Home badge keeps its label", () => {
  assert.match(bar({ homeBadge: "3" }), /aria-label="Home, 3 new"/);
});

test("desktop-only hides below lg; the public bar has no area nav", () => {
  assert.match(bar({ desktopOnly: true }), /<header[^>]*hidden lg:block/);
  assert.doesNotMatch(bar(), /<header[^>]*hidden lg:block/);
  assert.doesNotMatch(bar({ areas: [], brandTo: "/" }), /aria-label="Main"/);
  assert.match(bar(), /END/);
});

test("account menu: shelf, settings, admin only for admins, log out last and danger", () => {
  const items = (isAdmin: boolean) => accountMenuItems({ username: "ana", isAdmin, navigate: () => {}, logout: () => {} });
  assert.deepEqual(items(false).map((i) => i.label), ["My shelf", "Settings", "Log out"]);
  assert.deepEqual(items(true).map((i) => i.label), ["My shelf", "Settings", "Admin", "Log out"]);
  assert.equal(items(true).at(-1)!.danger, true);
  const went: string[] = [];
  accountMenuItems({ username: "ana", isAdmin: true, navigate: (to) => went.push(to), logout: () => {} }).slice(0, 3).forEach((i) => i.onClick());
  assert.deepEqual(went, ["/community/u/ana", "/dashboard/settings", "/admin/genres"]);
});

test("the account trigger is named, and a long username truncates in the menu heading", () => {
  const menu = readFileSync(new URL("../src/components/OptionsMenu.tsx", import.meta.url), "utf8");
  assert.match(menu, /heading\b[\s\S]*?truncate/);
  assert.match(readFileSync(new URL("../src/components/page/AccountMenu.tsx", import.meta.url), "utf8"), /title="Account menu"/);
});

test("the desktop sidebar is gone and pinned elements sit under the bar", () => {
  const read = (f: string) => readFileSync(new URL(`../src/${f}.tsx`, import.meta.url), "utf8");
  const layout = read("layouts/DashboardLayout");
  assert.doesNotMatch(layout, /<aside className="hidden/);
  assert.match(layout, /<main id="content"/);
  assert.match(layout, /pathname === `\/community\/u\/\$\{/);
  for (const f of ["components/OfflineBanner", "components/SwipeTabs", "pages/MuralEditorPage", "pages/SharedMuralPage", "components/Toolbar"]) {
    assert.doesNotMatch(read(f), /sticky top-0/, f);
    assert.match(read(f), /sticky top-\(--app-top\)/, f);
  }
  assert.match(read("pages/ReaderCardPage"), /lg:top-\[calc\(var\(--app-top\)\+1\.5rem\)\]/);
  assert.match(read("components/book/BookScreen"), /sm:top-\[calc\(var\(--app-top\)\+1\.5rem\)\]/);
});
```

In `test-areas.mts`:

```ts
test("the top bar lists every area but Settings and Admin", () => {
  assert.deepEqual(TOP_BAR_AREAS.map((a) => a.id), ["home", "library", "murals", "games", "readerCard", "community"]);
});
```

- [ ] **Step 2: Run** both files. Expected: FAIL (missing modules and exports).
- [ ] **Step 3: Implement.**
  - **`TopBar`**:
    - Root: `<header data-top-bar>` with `z-30 border-b border-(--color-border) bg-(--color-bg)/88 backdrop-blur-md lg:sticky lg:top-0`, prefixed with `hidden lg:block` when `desktopOnly`. It is sticky only from `lg`, because `--app-top` is 0 below it and phone-sticky rows such as `SharedMuralPage.tsx:111` would otherwise cover the public bar. If the `/88` modifier doesn't compile on a custom property, use `bg-[color-mix(in_srgb,var(--color-bg)_88%,transparent)]`, and confirm the bar is translucent in the browser.
    - The header's first child is the skip link, before the row: `sr-only focus:not-sr-only` plus a visible focused style, `focus:absolute focus:left-4 focus:top-3 focus:z-40 focus:rounded-lg focus:bg-(--color-surface) focus:px-4 focus:py-2.5 focus:font-semibold`.
    - Inner row: `flex h-16 items-center gap-4 px-4 sm:px-6 lg:px-8 xl:gap-7`.
    - Row children in order: `BrandLockup` in a 44px `Link` to `brandTo`; when `areas.length`, `<nav aria-label="Main" className="flex min-w-0 flex-1 items-center gap-0.5">`; then `<div className="ml-auto flex items-center">{end}</div>`.
    - Each area link: `inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-sm font-semibold xl:px-3.5`. Current: `bg-(--color-accent-soft) text-(--color-accent)` with `aria-current="page"`. Others: `text-(--color-text-dim) hover:bg-(--color-surface-hover) hover:text-(--color-text)`.
    - Home badge: `min-w-5 rounded-full bg-(--color-accent) px-1.5 text-center text-xs font-bold leading-5 text-(--color-on-accent)`, with `aria-label` `${label}, ${badge} new` on the link, as `SidebarNav` does.
  - **`OptionsMenu.heading`**: when set, render a first, non-interactive row (`truncate px-3 py-2 text-xs text-(--color-text-dim)`) above the items. Raise `MENU_WIDTH` to 176 when a heading is present.
  - **`AccountMenu`**: `OptionsMenu` with `title="Account menu"` and `heading={`@${user.username}`}`.
    - Trigger: `<Avatar user={user} size={32} />` plus the existing `ChevronDownIcon`, with `triggerClassName` `inline-flex min-h-11 items-center gap-1.5 rounded-full pl-1 pr-2 text-(--color-text-dim) hover:bg-(--color-surface-hover)`, plus `bg-(--color-surface-hover)` when `active`.
    - Items come from `accountMenuItems` with `useNavigate`.
  - **`DashboardLayout`**:
    - Delete the desktop `<aside className="hidden w-56 …">`. The More drawer's own `<aside>` stays.
    - The root changes from a row flexbox (`flex min-h-screen`) to `min-h-screen`, so the bar sits above `main`.
    - Render `<TopBar areas={TOP_BAR_AREAS} activeId={activeId} homeBadge={homeBadge} brandTo="/dashboard" desktopOnly end={<AccountMenu user={session.user} isAdmin={isAdmin} active={accountActive} onLogout={() => void logout()} />} />` above `<main id="content">`. `accountActive` is `activeId === "settings" || activeId === "admin" || pathname === `/community/u/${session.user.username}``.
    - The bottom bar, More drawer and `setNavHidden` stay as they are.
  - **Sticky offsets:**
    - Change `sticky top-0` to `sticky top-(--app-top)` in the five files the test names.
    - Move the two desktop-sticky columns under the bar: `ReaderCardPage.tsx:60`'s `lg:top-6` becomes `lg:top-[calc(var(--app-top)+1.5rem)]`, and `BookScreen.tsx:192`'s `sm:top-6` becomes `sm:top-[calc(var(--app-top)+1.5rem)]`.
  - If `SidebarNav` keeps working for the drawer, leave `test-sidebar-nav.mts` as is.
- [ ] **Step 4: Run** the tests and the Verify line. Then, in the browser at 1024×768, confirm the bar holds brand, six links and the account button on one line with no overflow. Measure with `document.querySelector('[data-top-bar] > div').scrollWidth <= innerWidth`.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/page/TopBar.tsx frontend/src/components/page/AccountMenu.tsx frontend/src/components/OptionsMenu.tsx frontend/src/components/Toolbar.tsx frontend/src/lib/areas.ts frontend/src/layouts/DashboardLayout.tsx frontend/src/components/OfflineBanner.tsx frontend/src/components/SwipeTabs.tsx frontend/src/pages/MuralEditorPage.tsx frontend/src/pages/SharedMuralPage.tsx frontend/src/pages/ReaderCardPage.tsx frontend/src/components/book/BookScreen.tsx frontend/scripts/test-top-bar.mts frontend/scripts/test-areas.mts && git commit -m "Replace the sidebar with a sticky top bar and account menu"
```

### Task 3: Page header and widths

**Files:**
- Modify: `frontend/src/components/page/Page.tsx`
- Modify: `frontend/src/layouts/PublicLayout.tsx`
- Modify: `frontend/src/pages/SharedLibraryPage.tsx`
- Modify: `frontend/src/pages/GalleryPage.tsx`
- Modify: `frontend/src/pages/DiscoverPage.tsx`
- Modify: `frontend/src/pages/ArenaListPage.tsx`
- Modify: `frontend/src/pages/MuralsListPage.tsx`
- Modify: `frontend/src/pages/AdminGenresPage.tsx`
- Modify: `frontend/src/pages/AdminSynopsesPage.tsx`
- Modify: `frontend/src/pages/AdminTranslationsPage.tsx`
- Modify: `frontend/src/pages/LibraryPage.tsx`
- Modify: `frontend/src/pages/GroupsPage.tsx`
- Modify: `frontend/src/pages/TierListCreatePage.tsx`
- Modify: `frontend/src/pages/QuizCreatePage.tsx`
- Modify: `frontend/src/pages/QuizEditorPage.tsx`
- Modify: `frontend/src/pages/PlayQuizPage.tsx`
- Test: `frontend/scripts/test-page-frame.mts`

**Interfaces:**
- Produces `Page` props: `title: ReactNode` (`null` means no title row), `subtitle?: ReactNode`, `back?: { to: string; label: string }`, `actions?: ReactNode`, `tabs?: readonly AreaTab[]`, `width?: PageWidth` (default `"default"`), `maxWidth?: number` (overrides the width class; the library pages pass the owner's width), `children: ReactNode`.
- Produces `export const PAGE_WIDTHS = { wide: 1440, default: 1200, narrow: 760 } as const` and `export type PageWidth = keyof typeof PAGE_WIDTHS`.
- Removes `PageWidthContext`. Its only users are `Page` and `PublicLayout`.

- [ ] **Step 1: Rewrite `test-page-frame.mts`.**
  - Keep the source tests from line 80 on, which check that pages use `Page` with tabs and back links.
  - Keep "a rename control can be the title" (`:34-37`) and "button classes meet the 44px floor" (`:75-78`) as they are.
  - Replace the other band and render tests above line 80 with the tests below. Each replaced test is superseded by one of them: band → no band, tabs → tabs, back link → back link above the title, padding and width → widths, title null → title null, controls below the band → actions on the title row.
  - Add the width source test.
  - The render helper drops the `PageWidthContext` wrapper.

```ts
test("no band: one display h1 at 30px, 40px from lg, wrapping", () => {
  const html = render(createElement(Page, { title: "A".repeat(120), children: "x" }));
  assert.equal(html.match(/<h1/g)?.length, 1);
  assert.match(html, /<h1 class="[^"]*font-display[^"]*break-words[^"]*text-3xl[^"]*font-bold[^"]*lg:text-\[2\.5rem\][^"]*lg:leading-\[3rem\]/);
  assert.doesNotMatch(html.slice(0, html.indexOf("</header>")), /bg-\(--color-surface\)/);
});

test("back link above the title, actions on the title row, subtitle under the title, tabs last", () => {
  const html = render(createElement(Page, { title: "Library", back: backTo("tournament"), subtitle: "84 books", actions: createElement("button", null, "Add a book"), tabs: area("library").tabs, children: "BODY" }), "/dashboard/library");
  const header = html.slice(0, html.indexOf("</header>"));
  assert.match(header, /<a(?=[^>]*href="\/dashboard\/arena")(?=[^>]*min-h-11)[^>]*>[\s\S]*?Games<\/a>[\s\S]*<h1[\s\S]*84 books[\s\S]*Add a book[\s\S]*aria-label="Sections"/);
  assert.match(html, /<\/header>[\s\S]*BODY/);
});

test("tabs: 44px, one current, underline on the hairline", () => {
  const html = render(createElement(Page, { title: "Games", tabs: area("games").tabs, children: "x" }));
  assert.equal(html.match(/<a(?=[^>]*min-h-11)(?=[^>]*border-b-2)(?=[^>]*-mb-px)[^>]*>/g)?.length, 3);
  assert.match(html, /<a(?=[^>]*aria-current="page")[^>]*>Quizzes<\/a>/);
  assert.equal(html.match(/aria-current="page"/g)?.length, 1);
});

test("widths: default 1200, wide 1440, narrow 760, maxWidth wins (owner's 800 and 1800)", () => {
  assert.match(render(createElement(Page, { title: "T", children: "x" })), /max-width:1200px/);
  assert.match(render(createElement(Page, { title: "T", width: "wide", children: "x" })), /max-width:1440px/);
  assert.match(render(createElement(Page, { title: "T", width: "narrow", children: "x" })), /max-width:760px/);
  for (const w of [800, 1800]) assert.match(render(createElement(Page, { title: "T", width: "wide", maxWidth: w, children: "x" })), new RegExp(`max-width:${w}px`));
  assert.match(render(createElement(Page, { title: "T", children: "x" })), /px-4 [^"]*sm:px-6 [^"]*lg:px-8/);
});

test("header and body share one container, gutters outside the width", () => {
  const html = render(createElement(Page, { title: "T", width: "wide", children: "BODY" }));
  assert.equal(html.match(/max-width:/g)?.length, 1);
  assert.match(html, /<div class="[^"]*px-4 [^"]*sm:px-6 [^"]*lg:px-8[^"]*"><div class="mx-auto[^"]*" style="max-width:1440px">[\s\S]*<header[\s\S]*BODY/);
});

test("title null drops the title row but keeps a back link and the container", () => {
  const html = render(createElement(Page, { title: null, back: backTo("profile") }, createElement("h1", null, "Ana")));
  assert.match(html, /<a(?=[^>]*min-h-11)[^>]*>[\s\S]*?Community<\/a>/);
  assert.equal(html.match(/<h1/g)?.length, 1);
  assert.match(html, /max-width:1200px/);
});

test("every Page in these files declares the width, loading states included", () => {
  const read = (f: string) => readFileSync(new URL(`../src/pages/${f}.tsx`, import.meta.url), "utf8");
  const every = (f: string, width: string) => {
    const pages = read(f).match(/<Page\b(?:[^>]|=>)*>/g) ?? [];
    assert.ok(pages.length > 0, f);
    for (const tag of pages) assert.match(tag, new RegExp(`width="${width}"`), `${f}: ${tag.slice(0, 80)}`);
  };
  for (const f of ["LibraryPage", "GroupsPage", "GalleryPage", "SharedLibraryPage", "DiscoverPage", "ArenaListPage", "MuralsListPage", "AdminGenresPage", "AdminSynopsesPage", "AdminTranslationsPage"]) every(f, "wide");
  for (const f of ["TierListCreatePage", "QuizCreatePage", "QuizEditorPage", "PlayQuizPage"]) every(f, "narrow");
});
```

- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement `Page`** as in the spec's "The page header":
  - One container: an outer `px-4 pb-16 sm:px-6 lg:px-8` div wrapping an inner `mx-auto` div with `style={{ maxWidth }}`. The gutters sit outside the width, so `default` gives 1200px of content and the mural canvas keeps its 1152px.
  - `<header className="pt-8 lg:pt-10">` holds the back link (`-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-(--color-text-dim) hover:text-(--color-text)`), then the title row (`flex flex-wrap items-end justify-between gap-x-6 gap-y-4`, with the `h1` classes the test pins plus `min-w-0`; subtitle `mt-1.5 text-sm text-(--color-text-dim)`; actions `flex flex-wrap items-center gap-2`), then the tabs (`nav aria-label="Sections"`, `mt-6 flex gap-7 overflow-x-auto border-b border-(--color-border)`; each link `-mb-px inline-flex min-h-11 shrink-0 items-center whitespace-nowrap border-b-2 text-sm font-semibold`, current `border-(--color-accent) text-(--color-text)`, others `border-transparent text-(--color-text-dim) hover:text-(--color-text)`).
  - Content wrapper: `mt-6` after tabs, `mt-8` otherwise.
  - With `title={null}` and `back`, the header holds only the back link. With neither, there is no header.
  - `PublicLayout` drops the provider.
  - Add `width` to every `<Page>` in the files the test lists, loading and error states included. The library pages keep passing `maxWidth={contentMaxWidth}`.
- [ ] **Step 4: Run** the file and the Verify line. Check in the browser at 1440 that Library, Home, Settings and a tier list editor show the new header and that nothing overlaps. Pages that still carry an old inner width (Settings, Reader card and so on) are expected; later phases replace them.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/page/Page.tsx frontend/src/layouts/PublicLayout.tsx frontend/src/pages/SharedLibraryPage.tsx frontend/src/pages/GalleryPage.tsx frontend/src/pages/DiscoverPage.tsx frontend/src/pages/ArenaListPage.tsx frontend/src/pages/MuralsListPage.tsx frontend/src/pages/AdminGenresPage.tsx frontend/src/pages/AdminSynopsesPage.tsx frontend/src/pages/AdminTranslationsPage.tsx frontend/src/pages/LibraryPage.tsx frontend/src/pages/GroupsPage.tsx frontend/src/pages/TierListCreatePage.tsx frontend/src/pages/QuizCreatePage.tsx frontend/src/pages/QuizEditorPage.tsx frontend/src/pages/PlayQuizPage.tsx frontend/scripts/test-page-frame.mts && git commit -m "Put the page header on the page and give pages three widths"
```

### Task 4: Public bar, and the app frame on shared pages

**Files:**
- Modify: `frontend/src/layouts/PublicLayout.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/VoteTierlistPage.tsx`
- Test: `frontend/scripts/test-public-layout.mts`

**Interfaces:**
- Consumes: `TopBar` (Task 2).
- Produces: `PublicLayout({ signedIn })` renders `TopBar` with `areas={[]}`, `activeId={null}` and `brandTo="/"`; its `end` is "Log in" (with `state={{ from: location }}`) or "Open my library", using `BUTTON_SECONDARY`. Below that comes `<main id="content"><Outlet /></main>`.

- [ ] **Step 1: Rewrite `test-public-layout.mts`.** Keep the `matchMedia` stub.

```ts
test("signed out: the bar with brand, Log in and no area nav", () => {
  const html = render(false);
  assert.match(html, /<header(?=[^>]*data-top-bar)/);
  assert.doesNotMatch(html, /<header[^>]*hidden lg:block/);
  assert.match(html, /<a(?=[^>]*href="\/login")[^>]*>Log in<\/a>/);
  assert.doesNotMatch(html, /aria-label="Main"/);
  assert.match(html, /<main id="content"/);
});

test("signed in without a username: Open my library", () => {
  assert.match(render(true), /<a(?=[^>]*href="\/dashboard")[^>]*>Open my library<\/a>/);
});

test("share, vote and play pages use the session frame; public /arena stays public", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const session = app.slice(app.indexOf("<Route element={<SessionLayout />}>"), app.indexOf("<Route element={<RequireAuth />}>"));
  for (const path of ["/shared/murals/:token", "/shared/library/:token", "/vote/:code", "/play/:code"]) assert.match(session, new RegExp(`path="${path}"`), path);
  const publicBlock = app.slice(app.indexOf("<Route element={<PublicRoutesLayout />}>"));
  assert.match(publicBlock, /path="\/arena"/);
  assert.doesNotMatch(publicBlock, /path="\/(shared|vote|play)\//);
});

test("the vote page hides the phone bottom bar while its pool dock shows, under either frame", () => {
  const vote = readFileSync(new URL("../src/pages/VoteTierlistPage.tsx", import.meta.url), "utf8");
  assert.match(vote, /useOutletContext<\{ setNavHidden\?: \(hidden: boolean\) => void \} \| undefined>\(\)/);
  assert.match(vote, /setNavHidden\?\.\(true\)/);
  assert.match(vote, /setNavHidden\?\.\(false\)/);
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Move the four routes into the `SessionLayout` block, next to `/arena/:id`.
  - Rebuild `PublicLayout` on `TopBar`.
  - Remove `PublicRoutesLayout` only if nothing else uses it. `/arena` still does.
  - `VoteTierlistPage` renders `TierBoard`, whose pool dock is `fixed bottom-0 z-40` (`TierBoard.tsx:382`) and expects the bottom bar hidden. Under `DashboardLayout` the bar would cover it on a phone.
    - Read `setNavHidden` from `useOutletContext`, typed optional because `PublicLayout` provides no context.
    - Call `setNavHidden?.(true)` in an effect while the board shows, with `setNavHidden?.(false)` on cleanup, as `TierListEditorPage.tsx:83-88` does.
- [ ] **Step 4: Run** the tests and the Verify line. In the browser, signed in, open a `/vote/<code>` and a `/shared/library/<token>` from the fixture: both show the top bar with areas. At 390 the vote page's pool dock is visible and not covered. Signed out (private window), both show the public bar.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/layouts/PublicLayout.tsx frontend/src/App.tsx frontend/src/pages/VoteTierlistPage.tsx frontend/scripts/test-public-layout.mts && git commit -m "Give public pages the bar and signed-in readers the app frame on shared links"
```

### Task 5: Phase 1 browser pass and PR

- [ ] **Step 1:** Do the browser pass ("Running the work") over Home, Library, Murals, Games, a tier list, Reader card, Community, Settings, a profile, a book page and a vote link. Also check that the top bar stays visible while scrolling Home to the bottom, and that tabbing from the address bar reaches "Skip to content" first.
- [ ] **Step 2:** Run `branch-reviewer`, Codex and the Verify line. Fix what both reviews raise.
- [ ] **Step 3:** Open the PR with the screenshots and enable auto-merge (the `ship` skill).

---

## Phase 2 — Library area and book page (PR 2)

### Task 6: Book-style cover

**Files:**
- Create: `frontend/src/components/book/BookCover.tsx`
- Create: `frontend/scripts/test-book-cover.mts`

**Interfaces:**
- Consumes: `CoverImage({ book, onHasCoverChange?, fit?, alt?, size? })`, exported from `frontend/src/components/BookCard.tsx:69`. It already resolves `_coverUrl`, the resolver cache and the `onError` fall-through, and `FinishSheet.tsx:18` and others share it.
- Produces: `BookCover(props: { book: LibraryBook; width?: number; size?: CoverSize }): JSX.Element`. It renders at `width` px when given and fills its container otherwise, which Task 11c's reading-strip grid needs. `size` defaults to `"thumb"`; the book page passes `"full"`.

- [ ] **Step 1: Write the failing test.** Render with `react-dom/server`, and stub `fetch` as `test-book-covers.mts` does if the resolver needs it.

```ts
test("a cover with an image: book corners, cover shadow, width, decorative img", () => {
  const html = render({ Title: "Dune", Attribution: "Frank Herbert", _coverUrl: "https://img/x.jpg" }, 84);
  assert.match(html, /rounded-\[2px_5px_5px_2px\]/);
  assert.match(html, /shadow-\(--shadow-cover\)|shadow-\[var\(--shadow-cover\)\]/);
  assert.match(html, /width:84px/);
  assert.match(html, /<img[^>]*alt=""[^>]*src="https:\/\/img\/x\.jpg"|<img[^>]*src="https:\/\/img\/x\.jpg"[^>]*alt=""/);
});

test("no cover: a hidden surface tile with the title sits under the image layer, never a broken image", () => {
  const html = render({ Title: "Untitled draft" }, 112);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /<span(?=[^>]*aria-hidden="true")(?=[^>]*bg-\(--color-surface\))[^>]*>[\s\S]*?Untitled draft/);
});

test("without a width it fills its track; cover loading is CoverImage's", () => {
  assert.doesNotMatch(render({ Title: "Dune" }), /width:\d/);
  assert.match(render({ Title: "Dune" }), /w-full/);
  assert.match(readFileSync(new URL("../src/components/book/BookCover.tsx", import.meta.url), "utf8"), /<CoverImage\b/);
});
```

`render(book, width?)` renders `BookCover` with `book as LibraryBook` and the optional width.

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `BookCover` root: `relative block aspect-[2/3] shrink-0 overflow-hidden rounded-[2px_5px_5px_2px] shadow-(--shadow-cover)`, with `style={{ width }}` when `width` is set and `w-full` otherwise.
  - Bottom layer: the fallback, an `aria-hidden="true"` span with `absolute inset-0 flex items-center justify-center bg-(--color-surface) border border-(--color-border) p-2 text-center text-xs font-semibold` and the book's `Title`.
  - Top layer: `<CoverImage book={book} size={size} />` in an `absolute inset-0` box. When there is an image it covers the fallback; when there isn't, or it fails, the fallback shows.
  - Spine shade on top: `after:absolute after:inset-y-0 after:left-0 after:w-[6%] after:bg-linear-to-r after:from-black/20 after:to-white/10`.
  - Covers are decorative (`alt=""` is `CoverImage`'s default); callers put the title in text beside them.
  - On hover inside a link, the cover lifts 3px: `transition-transform duration-180 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:-translate-y-0.75 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0`.
- [ ] **Step 4: Run** the test and the Verify line.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/book/BookCover.tsx frontend/scripts/test-book-cover.mts && git commit -m "Add the book-style cover"
```

### Task 7: Library Books header, sticky toolbar and status chips

**Files:**
- Modify: `packages/shared/src/library/libraryView.ts`
- Test: `packages/shared/src/library/libraryView.test.ts`
- Modify: `frontend/src/pages/LibraryPage.tsx`
- Modify: `frontend/src/components/LibraryToolbar.tsx`
- Modify: `frontend/src/components/Toolbar.tsx`
- Test: `frontend/scripts/test-library-view.mts`

**Interfaces:**
- Produces: `statusCounts(books: LibraryBook[]): Record<StatusFilter, number>`, exported from `@scripta/shared` beside `filterBooks`. It counts by `filterBooks(books, "", status)` for each `STATUS_FILTER_OPTIONS` value.
- Produces: `LibraryToolbar` gains `counts: Record<StatusFilter, number>` and renders one chip per `STATUS_FILTER_OPTIONS` entry (label `"All"` for `all`, otherwise the option's label) in place of the status select. Sort stays a labelled select.

- [ ] **Step 1: Write the failing tests.**

```ts
// libraryView.test.ts
test("statusCounts counts each status filter over the whole library", () => {
  const books = [{ ReadStatus: 1 }, { ReadStatus: 2 }, { ReadStatus: 2 }, { ReadStatus: 0 }, {}] as LibraryBook[];
  assert.deepEqual(statusCounts(books), { all: 5, reading: 1, finished: 2, unread: 2 });
});
```

```ts
// test-library-view.mts
test("the toolbar offers status chips with counts and announces the current one", () => {
  const html = renderToolbar({ status: "reading", counts: { all: 24, reading: 6, finished: 11, unread: 7 } });
  assert.equal(html.match(/<button(?=[^>]*aria-pressed)[^>]*>/g)?.length, 4);
  assert.match(html, /<button(?=[^>]*aria-pressed="true")[^>]*>Reading[\s\S]*?6/);
  assert.match(html, />All[\s\S]*?24/);
  assert.doesNotMatch(html, /All statuses/);
});

test("the Books header: the rename control stays in the subtitle and wraps, More and Add a book on the title row, sticky toolbar under the bar", () => {
  const page = readFileSync(new URL("../src/pages/LibraryPage.tsx", import.meta.url), "utf8");
  assert.match(page, /subtitle=\{[\s\S]*?aria-label="Library name"[\s\S]*?title="Rename your library"(?:[^>]|=>)*className="[^"]*min-w-0[^"]*break-all/);
  assert.match(page, /actions=\{[\s\S]*?Add a book/);
  assert.match(readFileSync(new URL("../src/components/Toolbar.tsx", import.meta.url), "utf8"), /export function ToolbarRow[\s\S]*?sticky top-\(--app-top\)(?![^"]*sm:static)/);
});
```

`renderToolbar` renders `LibraryToolbar` with no-op handlers and the given props; read its current prop list before writing the helper.

- [ ] **Step 2: Run** `npm test --workspace packages/shared` and the frontend file. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `statusCounts`, exported from the shared index.
  - Chips with `chipClass(selected)` and `aria-pressed`, in a `role="group" aria-label="Status"` row that scrolls horizontally below `sm`.
  - The search field takes `FIELD_CLASS` with a leading search icon, `sm:w-85`.
  - `ToolbarRow` becomes `sticky top-(--app-top) z-20 -mx-4 bg-(--color-bg) px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8` at every width, with no negative top margin. This deliberately makes the Series, Collections, Murals and Games toolbars sticky too (`GroupsPage.tsx:341`, `MuralsListPage.tsx:203`, `ArenaListPage.tsx:122`). Check those in Step 4.
  - `LibraryPage` passes `counts={useMemo(() => statusCounts(books), [books])}`.
  - Its subtitle keeps today's inline rename control (`LibraryPage.tsx:325-350`), the only way to rename a library, followed by " · N books". Its input takes `FIELD_CLASS`.
  - Its actions are the More menu (`toolbarIconClass()`) and **Add a book** (`BUTTON_PRIMARY`).
  - The `?action=import` panel becomes a `PANEL` with `p-4`.
- [ ] **Step 4: Run** the tests and the Verify line. In the browser:
  - Scroll Library: the toolbar sticks under the bar at 1440 and at the top at 390.
  - The owner's width of 800 lines the header up with the grid.
  - Renaming the library still works.
  - The Series, Collections, Murals and Games toolbars stick without covering their first row.
- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/library/libraryView.ts packages/shared/src/library/libraryView.test.ts frontend/src/pages/LibraryPage.tsx frontend/src/components/LibraryToolbar.tsx frontend/src/components/Toolbar.tsx frontend/scripts/test-library-view.mts && git commit -m "Show library status as chips with counts in a sticky toolbar"
```

### Task 8: Series, Collections and Gallery

**Files:**
- Modify: `frontend/src/pages/GroupsPage.tsx`
- Modify: `frontend/src/pages/GalleryPage.tsx`
- Test: `frontend/scripts/test-groups.mts`

**Interfaces:**
- Consumes: `SECTION_HEADING`, `LIST_ROW` (Task 1), `EmptyState`.

- [ ] **Step 1: Write the failing test** (append to `test-groups.mts`).

```ts
test("groups are sections, not cards, and an empty group uses EmptyState", () => {
  const groups = readFileSync(new URL("../src/pages/GroupsPage.tsx", import.meta.url), "utf8");
  assert.match(groups, /<section(?:[^>]|=>)*aria-labelledby=/);
  assert.match(groups, /border-t border-\(--color-border\)/);
  assert.doesNotMatch(groups, /<p className="[^"]*">No books here yet/);
  assert.match(groups, /<EmptyState(?:[^>]|=>)*title="No books here yet"/);
});
```

The empty area (`GroupsPage.tsx:354`) and Gallery (`GalleryPage.tsx:143`) already use `EmptyState`. The one-line empty-group text (`GroupsPage.tsx:452`) is what moves.

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Each group renders as a `<section aria-labelledby>`. Its heading row holds the name (`text-lg font-bold`), a "N books" count (`text-sm text-dim`), the "custom style" chip and its `OptionsMenu`. Its covers render in the owner's style, as today.
  - Groups are separated by `border-t border-(--color-border) pt-8 mt-8`, and the white card wrapper goes.
  - An empty group renders `<EmptyState title="No books here yet" body='Use "Manage books" to add some.' />` in place of the line at `:452`.
- [ ] **Step 4: Run** the test and the Verify line, and check Series and Collections in the browser at 1440 and 390.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/GroupsPage.tsx frontend/src/pages/GalleryPage.tsx frontend/scripts/test-groups.mts && git commit -m "Lay out series and collections as sections"
```

### Task 9: Book and Work page hero

**Files:**
- Modify: `frontend/src/components/book/BookScreen.tsx`
- Modify: `frontend/src/pages/WorkPage.tsx`
- Modify: `frontend/src/pages/BookKeyPage.tsx`
- Test: `frontend/scripts/test-work-page.mts`

**Interfaces:**
- Consumes: `BookCover` (Task 6), `Page` with `title={null}` and `back` (Task 3), `LIST_PANEL`/`LIST_ROW` (Task 1).
- Produces: `BookScreen`'s `frame` prop becomes `frame: (body: ReactNode) => ReactNode`. Its callers pass `(body) => <Page title={null} back={back}>{body}</Page>`. The loading and not-found states keep `<Page title="Book" back={back}>`.

- [ ] **Step 1: Update `test-work-page.mts`.**
  - The `frame` stub (`:30`) becomes one argument: `frame: (body: ReactNode) => body`. Otherwise every render comes out empty.
  - The test asserting there is no `<h1` (`:134-139`) now asserts exactly one, in the hero.
  - The `▾` pins at `:61`, `:62`, `:91` and `:110` assert the labels without the glyph.
  - Then add the tests below. The tab labels are the shared model's (`packages/shared/src/works/bookScreen.ts:79,112`: "About", "Highlights (N)", "Community (N)"), which the phone app uses too; don't rename them.

```ts
test("the hero holds the only h1, with Share and More on the title row", () => {
  const html = renderOwnedBook();
  assert.equal(html.match(/<h1/g)?.length, 1);
  assert.match(html, /<h1[^>]*class="[^"]*font-display[^"]*lg:text-5xl[^"]*"[^>]*>[^<]+<\/h1>[\s\S]*?aria-label="Share"/);
});

test("sections are labelled underline tabs with the current one announced", () => {
  const html = renderOwnedBook();
  const nav = html.match(/<nav aria-label="Book sections"[\s\S]*?<\/nav>/)![0];
  assert.match(nav, />About</);
  assert.match(nav, /aria-current="page"/);
  assert.match(nav, /border-b-2/);
});

test("the status menu shows its label with a check, not a ▾ glyph", () => {
  const html = renderOwnedBook();
  assert.doesNotMatch(html, /▾/);
  assert.match(html, /aria-haspopup="menu"[^>]*>[\s\S]*?Finished/);
});
```

`renderOwnedBook()` is the file's existing owner render (`render({ book: … })` with the file's fixtures); reuse it.

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the spec's "Book and Work pages":
  - At `lg`, the grid is `lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)] lg:gap-14`.
  - Left column (sticky at `lg:top-[calc(var(--app-top)+1.5rem)]`): `EditionStrip` when it applies today, else `<BookCover book={heroBook} size="full" />` filling the 280px column, with the cover menu unchanged; then the stats tiles as one 3-up `PANEL` strip.
  - Right column (`max-w-190`):
    - The `h1` (`font-display text-4xl font-bold lg:text-5xl lg:leading-14 break-words`) with the existing `headerActions` (now `toolbarIconClass()` round buttons) on its row.
    - "by" and the author.
    - The meta line: `RatingStars`, `model.meta` and the series label.
    - Genre chips and award pills.
    - Status: `OptionsMenu` whose trigger is the label plus a check icon, `triggerClassName` `inline-flex min-h-11 items-center gap-2 rounded-lg border border-(--color-accent) bg-(--color-accent-soft) px-4 text-sm font-semibold text-(--color-accent)`.
    - The feeling menu, in `BUTTON_SECONDARY` style, with its trigger's `▾` (`BookScreen.tsx:260`) replaced by `ChevronDownIcon`.
    - `<nav aria-label="Book sections">` with underline tabs built from `model.tabs` as buttons with `aria-current`. The count is shown when the model provides one.
    - The sections. Editions render as a `LIST_PANEL` whose rows have a `BookCover` at 36.
  - Keep the cover-colour `wash`, re-anchored to the new container (`-inset-x-4 sm:-inset-x-6 lg:-inset-x-8`, top at the header).
  - Characters move from the left column into a "Characters" section on the right.
- [ ] **Step 4: Run** the tests and the Verify line. In the browser, check an owned book, an unowned book (Add to library as the single primary) and a signed-out `/work/:id` at 1440 and 390.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/book/BookScreen.tsx frontend/src/pages/WorkPage.tsx frontend/src/pages/BookKeyPage.tsx frontend/scripts/test-work-page.mts && git commit -m "Rebuild the book page hero with labelled section tabs"
```

### Task 10: Phase 2 browser pass and PR

- [ ] Same three steps as Task 5, over Books (each status chip, search, sort, owner's width 800 and 1800 via Style), Series, Collections, Gallery and three book pages.

---

## Phase 3a — Social Home: layout, games, feed, For you (PR 3)

The Home section of the spec was rewritten with the user on 2026-10-30. Home now mirrors the phone app's Home, uses only existing endpoints, and its reference is the canvas's "Home" artboard. Every new Home query uses `staleTime: 30_000` and `retry: 1`, as the app does. The engagement routes share a 60/min budget, and the web `QueryClient` otherwise refetches on every focus.

### Task 11a: Move the app's Home view models to shared

**Files:**
- Create: `packages/shared/src/community/feedRowModel.ts`
- Create: `packages/shared/src/community/feedRowModel.test.ts`
- Create: `packages/shared/src/community/activityModel.ts`
- Create: `packages/shared/src/community/activityModel.test.ts`
- Create: `packages/shared/src/community/homeModel.ts`
- Create: `packages/shared/src/community/homeModel.test.ts`
- Create: `packages/shared/src/works/awardCardModel.ts`
- Create: `packages/shared/src/works/awardCardModel.test.ts`
- Modify: `packages/shared/src/community/index.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `mobile/src/features/home/feedRowModel.ts`
- Modify: `mobile/src/features/home/feedRowModel.test.ts`
- Delete: `mobile/src/features/home/activityModel.ts`
- Delete: `mobile/src/features/home/activityModel.test.ts`
- Delete: `mobile/src/features/home/homeModel.ts`
- Delete: `mobile/src/features/awards/awardCardModel.ts`
- Delete: `mobile/src/features/awards/awardCardModel.test.ts`
- Modify: `mobile/src/features/home/HomeFeedRow.tsx`
- Modify: `mobile/src/features/home/FeedPreview.tsx`
- Modify: `mobile/src/features/home/ActivityRow.tsx`
- Modify: `mobile/src/features/home/ActivityScreen.tsx`
- Modify: `mobile/src/features/home/SavedContentSheet.tsx`
- Modify: `mobile/src/features/home/HomeScreen.tsx`
- Modify: `mobile/src/features/home/CommentsSheet.tsx`
- Modify: `mobile/src/features/home/useHomeActions.ts`
- Modify: `mobile/src/features/awards/AwardHomeCard.tsx`

**Interfaces:**
- Produces, unchanged in name and signature, from `@scripta/shared/community`:
  - `FeedRowModel`, `feedRowModel`, `feedRowAccessibilityLabel`, `feedEventLabel`, `feedPrimaryLabel`, `readingShelfBook`, `feedShareTarget`, `hasActivityThread`, `reactionCount` (all from `mobile/src/features/home/feedRowModel.ts`);
  - `PersonalItem`, `ActivityAction`, `ActivityRowModel`, `isPersonalItem`, `activityRowModel`, `activitySentence` (`activityModel.ts`);
  - `shouldMarkFeedSeen` (`homeModel.ts:1`).
- Produces from `@scripta/shared`: `AwardCardModel`, `awardKey`, `awardCardModel`, `firstUndismissed` (`awards/awardCardModel.ts`).
- Produces `FeedRowModel.icon: FeedIconName`, where `export type FeedIconName = "tierlist" | "champion" | "arena" | "vote" | "book" | "follow" | "bracket" | "murals"` replaces the React Native `IconName` import. Mobile keeps passing it to its icon component.
- `digestRoute` returns Expo routes, so it stays in `mobile/src/features/home/feedRowModel.ts` with its tests (`feedRowModel.test.ts:142-163`). That file keeps only `digestRoute`. `relativeTime` is already shared (`packages/shared/src/community/helpers.ts:222`), so drop its re-export.

- [ ] **Step 1: Move the tests.** Move every test except `digestRoute`'s into the shared files (`feedRowModel.test.ts` 16 tests, `activityModel.test.ts` 5, `homeModel` 1 new, `awardCardModel.test.ts` 10), with imports pointing at the new shared modules.

```ts
// packages/shared/src/community/homeModel.test.ts
test("the feed is marked seen once, only when focused, loaded, idle and a row is visible", () => {
  const base = { focused: true, rowVisible: true, loaded: true, failed: false, fetching: false, sent: false };
  assert.equal(shouldMarkFeedSeen(base), true);
  for (const key of ["focused", "rowVisible", "loaded"] as const) assert.equal(shouldMarkFeedSeen({ ...base, [key]: false }), false, key);
  for (const key of ["failed", "fetching", "sent"] as const) assert.equal(shouldMarkFeedSeen({ ...base, [key]: true }), false, key);
});
```

- [ ] **Step 2: Run** `npm test --workspace packages/shared`. Expected: FAIL (modules missing).
- [ ] **Step 3: Move the modules and point every importer at the shared ones.** Export the community models from `community/index.ts`, and the award model from the root index next to the other `works` exports.
- [ ] **Step 4: Run** `npm test --workspace packages/shared && npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile`. Expected: PASS, with the same test counts as before the move (minus none).
- [ ] **Step 5: Commit**

```bash
git add -A packages/shared/src/community packages/shared/src/works packages/shared/src/index.ts mobile/src/features/home mobile/src/features/awards && git commit -m "Move the app's Home view models to shared"
```

### Task 11b: Home feeds, games and awards data

**Files:**
- Modify: `frontend/src/hooks/useDashboard.ts`
- Modify: `frontend/src/layouts/DashboardLayout.tsx`
- Create: `frontend/src/api/topShelf.ts`
- Modify: `frontend/src/api/works.ts`
- Create: `frontend/src/lib/homeGames.ts`
- Create: `frontend/scripts/test-home-games.mts`

**Interfaces:**
- Consumes: `fetchDashboard(cursor?, kinds?)` with `CIRCLE_DIGEST_KINDS` / `PERSONAL_DIGEST_KINDS` (`packages/shared/src/dashboard.ts:77-80`); `fetchTopShelf({ period, genre, view })` (`packages/shared/src/topShelf/api.ts:16`); `fetchRecentAwards()` (`packages/shared/src/works/api.ts:24`); `fetchDiscover` via `useCommunityDiscover("all", "")` (`frontend/src/hooks/useCommunity.ts:25`).
- Produces in `useDashboard.ts`, alongside the existing `useDashboard` (Task 11c deletes it):
  - `useCircleFeed()`: an infinite query, key `["community","dashboard","circle"]`. Returns `{ items: DigestItem[]; isLoading; error; hasNextPage; fetchNextPage; isFetchingNextPage; refetch }`.
  - `useActivityFeed()`: key `["community","dashboard","activity"]`, the same key the app uses. Returns `{ items: DigestItem[]; seenAt: string | null; personalNewCount: number; isLoading; error; hasNextPage; fetchNextPage; refetch }`.
- Produces `fetchTopShelf` in `frontend/src/api/topShelf.ts` and `fetchRecentAwards` in `frontend/src/api/works.ts`, bound to the web `request` the way `frontend/src/api/community.ts` binds `createCommunityApi(request)`.
- Produces `homeGames(input: { circle: DigestItem[]; popular: TopShelfGame[]; newest: DiscoverItem[]; viewerId: string }): { followed: DiscoverItem[]; others: DiscoverItem[]; othersLabel: "Popular this month" | "New games" }`. `TopShelfGame` is the element type of `TopShelf["games"]` (`packages/shared/src/topShelf/types.ts:7-15`).
  - `followed` is the circle's `publication` items mapped to `{ author: item.actor, content: item.content }`, at most 2.
  - `others` is the popular items minus your own (`author.userId === viewerId`) and minus anything already in `followed`, at most 2, labelled "Popular this month".
  - When `followed` and `others` are both empty, `others` is the newest non-own items, at most 2, labelled "New games".

- [ ] **Step 1: Write the failing tests** (`test-home-games.mts`). Build the fixtures from the shapes in `packages/shared/src/dashboard.test.ts` and `topShelf/api.test.ts`.

```ts
test("followed games come from the circle's publications, at most two", () => {
  const out = homeGames({ circle: [pub("t1", "alice"), reading("b1"), pub("q1", "alice"), pub("q2", "bob")], popular: [], newest: [], viewerId: "me" });
  assert.deepEqual(out.followed.map((g) => g.content.id), ["t1", "q1"]);
});

test("popular drops your own games and ones already followed, at most two", () => {
  const out = homeGames({ circle: [pub("t1", "alice")], popular: [hot("mine", "me"), hot("t1", "alice"), hot("p1", "joana"), hot("p2", "ines"), hot("p3", "x")], newest: [], viewerId: "me" });
  assert.deepEqual(out.others.map((g) => g.content.id), ["p1", "p2"]);
  assert.equal(out.othersLabel, "Popular this month");
});

test("with nothing followed or popular, the newest public games fill in", () => {
  const out = homeGames({ circle: [], popular: [], newest: [game("mine", "me"), game("n1", "joana"), game("n2", "ines")], viewerId: "me" });
  assert.deepEqual(out.others.map((g) => g.content.id), ["n1", "n2"]);
  assert.equal(out.othersLabel, "New games");
});

test("the Home badge counts the personal feed, and the new hooks keep the app's cache budget", () => {
  const read = (f: string) => readFileSync(new URL(`../src/${f}.tsx`, import.meta.url), "utf8");
  assert.match(read("layouts/DashboardLayout"), /useActivityFeed\(\)/);
  const hooks = readFileSync(new URL("../src/hooks/useDashboard.ts", import.meta.url), "utf8");
  assert.match(hooks, /CIRCLE_DIGEST_KINDS/);
  assert.match(hooks, /PERSONAL_DIGEST_KINDS/);
  assert.equal(hooks.match(/staleTime: 30_000/g)?.length, 2);
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the two hooks, the two API bindings and `homeGames`. In `DashboardLayout`, take the badge from `useActivityFeed().personalNewCount` instead of `useDashboard()`.
- [ ] **Step 4: Run** the test and the Verify line.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useDashboard.ts frontend/src/layouts/DashboardLayout.tsx frontend/src/api/topShelf.ts frontend/src/api/works.ts frontend/src/lib/homeGames.ts frontend/scripts/test-home-games.mts && git commit -m "Add the circle and activity feeds and pick Home's games"
```

### Task 11c: Home layout, games, awards card, reading strip, suggestions

**Files:**
- Modify: `frontend/src/pages/HomePage.tsx`
- Create: `frontend/src/components/games/DiscoverTicket.tsx`
- Modify: `frontend/src/pages/DiscoverPage.tsx`
- Create: `frontend/src/components/home/AwardsCard.tsx`
- Create: `frontend/src/components/home/ReadingStrip.tsx`
- Create: `frontend/src/components/home/SuggestedReaders.tsx`
- Modify: `frontend/src/hooks/useDashboard.ts`
- Test: `frontend/scripts/test-dashboard-cards.mts`

**Interfaces:**
- Consumes: `homeGames`, `useCircleFeed`, `fetchTopShelf`, `fetchRecentAwards` (Task 11b); `awardCardModel`, `firstUndismissed`, `awardKey` (Task 11a); `BookCover` (Task 6); `useSuggestedPeople`, `followUser` (`frontend/src/hooks/useCommunity.ts:52`, `frontend/src/api/community.ts`); `SECTION_HEADING`, `PANEL`, `LIST_PANEL`, `PANEL_HEADING` (Task 1).
- Produces:
  - `DiscoverTicket({ item }: { item: DiscoverItem })`, extracted unchanged from `DiscoverPage`'s private `DiscoverRow` (`DiscoverPage.tsx:118`).
  - `AwardsCard({ announcements, library })`.
  - `ReadingStrip({ books })`.
  - `SuggestedReaders()`.
- Deletes `useDashboard` once nothing uses it.

- [ ] **Step 1: Write the failing tests** (`test-dashboard-cards.mts`, source assertions in the suite's style).

```ts
const read = (f: string) => readFileSync(new URL(`../src/${f}.tsx`, import.meta.url), "utf8");

test("Home: two columns from lg, awards card, games from homeGames, reading strip and suggestions", () => {
  const home = read("pages/HomePage");
  assert.match(home, /lg:grid-cols-\[minmax\(0,1fr\)_340px\]/);
  for (const part of ["<AwardsCard", "<DiscoverTicket", "<ReadingStrip", "<SuggestedReaders"]) assert.match(home, new RegExp(part), part);
  assert.match(home, /homeGames\(/);
  assert.match(home, /Browse all/);
  assert.doesNotMatch(home, /useDashboard\(/);
  assert.doesNotMatch(home, /Rediscover|Up next|Currently reading/);
});

test("the reading strip: five covers, progress when known, a link to the Reading filter", () => {
  const strip = read("components/home/ReadingStrip");
  assert.match(strip, /<BookCover/);
  assert.match(strip, /readingPercent\(/);
  assert.match(strip, /\.slice\(0, 5\)/);
  assert.match(strip, /\/dashboard\/library\?status=reading/);
});

test("Discover and Home share one ticket", () => {
  assert.match(read("pages/DiscoverPage"), /<DiscoverTicket/);
  assert.doesNotMatch(read("pages/DiscoverPage"), /function DiscoverRow/);
});

test("the awards card uses the shared model, links a work, and can be dismissed", () => {
  const card = read("components/home/AwardsCard");
  assert.match(card, /awardCardModel\(/);
  assert.match(card, /firstUndismissed\(/);
  assert.match(card, /aria-label="Dismiss"/);
});

test("suggestions: at most three, Follow as a secondary button, See all to People", () => {
  const s = read("components/home/SuggestedReaders");
  assert.match(s, /\.slice\(0, 3\)/);
  assert.match(s, /BUTTON_SECONDARY[\s\S]*?Follow|Follow[\s\S]*?BUTTON_SECONDARY/);
  assert.match(s, /\/community\/people/);
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**, following the spec's Home section and the canvas:
  - **HomePage**: `<Page title="Home">` with `grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]`.
    - Main column: `AwardsCard` when `firstUndismissed` returns one; the Games section (`SECTION_HEADING`, "Browse all →" to `/community/discover`, "From people you follow" then `othersLabel`, two `DiscoverTicket`s each in `[grid-template-columns:repeat(auto-fill,minmax(340px,1fr))] gap-4`); then a "Your reading circle" section that Task 11d fills.
    - Side column: a For you slot that Task 11d fills, `ReadingStrip`, then `SuggestedReaders`.
    - An empty library swaps `ReadingStrip` for today's "Start your library" content as an `EmptyState` (Import library primary, Add a book secondary).
    - Keep `PickNextSheet` out; the reading strip replaces Up next.
  - **AwardsCard**:
    - Uses the app's shell: `PANEL` with a 16px radius, a 40×60 `BookCover`, the prize line, and title and author.
    - The `accent` shelf line comes from the model and is omitted when null.
    - The card links to `/work/:id` when the model's target is a work, and is not a link for the `{ kind: "search" }` target, which has no web route.
    - Dismissal stores `awardKey` values under `localStorage` key `dismissedAwards`, guarded with try/catch so a blocked storage just shows the card.
  - **ReadingStrip**:
    - A `PANEL` with a `PANEL_HEADING` "Your reading" plus the count, and "Library →" to `/dashboard/library?status=reading`.
    - A 5-column grid of `BookCover`s with no width, each with a `h-0.75` progress bar when `readingPercent` is not null.
  - **SuggestedReaders**: a `LIST_PANEL` of `useSuggestedPeople(true)`'s first three, each with avatar, name, reason and Follow (`BUTTON_SECONDARY`, `followUser`, then invalidate `["community","people"]`), plus "See all →".
- [ ] **Step 4: Run** the tests and the Verify line.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/HomePage.tsx frontend/src/components/games/DiscoverTicket.tsx frontend/src/pages/DiscoverPage.tsx frontend/src/components/home/AwardsCard.tsx frontend/src/components/home/ReadingStrip.tsx frontend/src/components/home/SuggestedReaders.tsx frontend/src/hooks/useDashboard.ts frontend/scripts/test-dashboard-cards.mts && git commit -m "Rebuild Home around games, the reading strip and suggestions"
```

### Task 11d: Circle feed cards and the For you panel

**Files:**
- Create: `frontend/src/components/home/FeedCard.tsx`
- Create: `frontend/src/components/home/ForYouPanel.tsx`
- Modify: `frontend/src/pages/HomePage.tsx`
- Create: `frontend/scripts/test-feed-card.mts`
- Test: `frontend/scripts/test-controls.mts`

**Interfaces:**
- Consumes: `feedRowModel`, `feedEventLabel`, `feedPrimaryLabel`, `feedRowAccessibilityLabel`, `activityRowModel`, `shouldMarkFeedSeen` (Task 11a); `useCircleFeed`, `useActivityFeed` (Task 11b); `digestTarget`, `relativeTime`, `newCountLabel`, `markDashboardSeen` (already shared and bound); `AuthorAvatar` (`frontend/src/components/CommunityAuthorAvatar.tsx`); `ReaderGlyph`; `BookCover`.
- Produces:
  - `FeedCard({ item }: { item: DigestItem })`, which Task 12a extends with actions.
  - `ForYouPanel()`.

- [ ] **Step 1: Write the failing tests** (`test-feed-card.mts`).
  - Render with `react-dom/server` inside `MemoryRouter`, plus a `QueryClientProvider` where a component needs one.
  - Reuse the fixtures from `packages/shared/src/community/feedRowModel.test.ts` and `activityModel.test.ts` (Task 11a).
  - In `test-controls.mts`, replace the old Home row assertion (`:28-32`) with: `assert.match(src("components/home/FeedCard"), /min-h-11/)`.

```ts
test("a finished book: avatar, name, event label, time, cover, title, author, and its primary link", () => {
  const html = card(finishedReading);
  assert.match(html, /<article/);
  assert.match(html, new RegExp(feedEventLabel(finishedReading)));
  assert.match(html, />Piranesi</);
  assert.match(html, /Susanna Clarke/);
  assert.match(html, new RegExp(`href="${digestTarget(finishedReading)}"`));
});

test("a tournament shows VS covers, a quiz the ? disc, a mural its tile", () => {
  assert.match(card(publishedTournament), />VS</);
  assert.match(card(publishedQuiz), />\?</);
  assert.match(card(publishedMural), /Open mural/);
});

test("For you: Follow back, View results and Following, with the new count", () => {
  const html = forYou([followedMe, playedMyQuiz, followedMeAlreadyFollowing], { personalNewCount: 2 });
  assert.match(html, /<button[^>]*>Follow back<\/button>/);
  assert.match(html, /View results/);
  assert.match(html, />Following</);
  assert.match(html, /2 new/);
});

test("For you marks the feed seen only through the shared gate", () => {
  const src = readFileSync(new URL("../src/components/home/ForYouPanel.tsx", import.meta.url), "utf8");
  assert.match(src, /IntersectionObserver/);
  assert.match(src, /shouldMarkFeedSeen\(/);
  assert.match(src, /markDashboardSeen\(/);
});
```

`card(item)` renders `FeedCard`. `forYou(items, page)` renders `ForYouPanel` with a `QueryClient` seeded via `setQueryData(["community","dashboard","activity"], …)` in the shape `useActivityFeed` reads.

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the spec's feed card and For you.
  - **FeedCard** is a `PANEL` article with a 16px radius, `px-4.5 pt-4 pb-2`.
    - Header: a 36px `AuthorAvatar` with the name linking to the profile and the `feedEventLabel` under it, then the `relativeTime`.
    - Preview by kind:
      - book: a `BookCover` at 72 next to the title (`font-display text-[22px] font-bold`), the author, and the `feedPrimaryLabel` link;
      - tournament: two `BookCover`s at 40, rotated ±7°, with "VS" on an `accent-soft` tile;
      - quiz: a two-cover fan and a `?` disc on a `reference-soft` tile;
      - mural: an `aspect-[16/6]` tile with "Open mural →";
      - any other kind: the model's icon in a 48×72 tile.
    - Map `FeedIconName` to the web nav icons (`frontend/src/components/NavIcons.tsx`).
    - Set the article's `aria-label` from `feedRowAccessibilityLabel`.
  - **ForYouPanel**: a `LIST_PANEL` with a `PANEL_HEADING` "For you" and the `newCountLabel` chip.
    - Rows come from `activityRowModel`: a 32px avatar, the sentence, the time, and an 8px `accent` dot (labelled "New") when newer than `seenAt`.
    - The action is **Follow back** (`BUTTON_SECONDARY`, `followUser`), a "View results →" link, or "Following" in `text-dim`.
    - Show the first 6 rows; "Show more" calls `fetchNextPage`.
    - Mark seen through an `IntersectionObserver` on the rows, gated by `shouldMarkFeedSeen`.
  - **HomePage**: "Your reading circle" renders `FeedCard`s from `useCircleFeed` with "Load more", and "Find people →" on the heading row. When you follow nobody, it shows the app's onboarding copy with a **Find people** `BUTTON_PRIMARY`.
- [ ] **Step 4: Run** the tests and the Verify line.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/home/FeedCard.tsx frontend/src/components/home/ForYouPanel.tsx frontend/src/pages/HomePage.tsx frontend/scripts/test-feed-card.mts frontend/scripts/test-controls.mts && git commit -m "Show the reading circle as the app's feed cards and add For you"
```

### Task 12: Phase 3a browser pass and PR

- [ ] Same steps as Task 5, over Home at all four sizes and three themes. Cover:
  - an account that follows people (the fixture) and one that follows nobody;
  - Follow back, Load more and "Show more";
  - that the Home badge clears after For you has been on screen.

---

## Phase 3b — Feed actions and Saved (PR 4)

### Task 12a: Like, save, share and Want to read on feed cards, and the Saved page

**Files:**
- Modify: `frontend/src/api/community.ts`
- Create: `frontend/src/hooks/useFeedActions.ts`
- Modify: `frontend/src/components/home/FeedCard.tsx`
- Create: `frontend/src/pages/SavedPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/pages/HomePage.tsx`
- Test: `frontend/scripts/test-feed-card.mts`

**Interfaces:**
- Consumes: from `packages/shared/src/community/api.ts`, `likeActivity`, `fetchActivityEngagement` (1–50 ids), `saveContent`, `fetchSavedState`, `fetchSavedContent`; `savedContentRef` (`packages/shared/src/dashboard.ts:46`); `reactionCount`, `hasActivityThread`, `feedShareTarget`, `readingShelfBook` (Task 11a); `addBookToLibrary` (`frontend/src/api/library.ts:46`).
- Produces:
  - Those five functions, bound in `frontend/src/api/community.ts`'s `createCommunityApi(request)` destructure.
  - `useFeedActions(items: DigestItem[]): { engagement: Record<string, ActivityEngagement>; saved: Set<string>; like(item): void; save(item): void; wantToRead(item): void; share(item): void }`. It is the web port of the app's `useHomeActions` (`mobile/src/features/home/useHomeActions.ts:19`):
    - the engagement query key is `["community","engagement", ids]`, batched in chunks of 50, with `staleTime: 30_000`;
    - like and save are optimistic and roll back on error with a toast;
    - Want to read calls `addBookToLibrary({ title, author, isbn: isbn ?? null, coverUrl: coverUrl ?? null, readStatus: 0, preserveExisting: true })`, then invalidates `["library"]`;
    - share uses `navigator.share` when present, else copies `${location.origin}${feedShareTarget(item)}` with a toast, as `WorkPage.tsx:57-67` does.
  - Route `/dashboard/saved` → `SavedPage`, under `RequireUsername`.

- [ ] **Step 1: Write the failing tests** (append to `test-feed-card.mts`).

```ts
test("the footer: like with its count and pressed state, comments with count, share", () => {
  const html = card(finishedReading, { engagement: { [finishedReading.id]: { likes: 2, liked: true, comments: 1 } } });
  assert.match(html, /<button(?=[^>]*aria-pressed="true")(?=[^>]*aria-label="Like, 2 likes")[^>]*>/);
  assert.match(html, /<button(?=[^>]*aria-label="Comments, 1")[^>]*>/);
  assert.match(html, /<button[^>]*>[\s\S]*?Share<\/button>/);
});

test("save in the header; Want to read, or Open in your shelf when you hold the book", () => {
  assert.match(card(finishedReading), /<button(?=[^>]*aria-label="Save")(?=[^>]*aria-pressed="false")[^>]*>/);
  assert.match(card(finishedReading), /<button[^>]*>Want to read<\/button>/);
  assert.match(card(finishedReading, { library: [piranesiOnShelf] }), /Open in your shelf/);
});

test("actions keep the app's limits and paths", () => {
  const hook = readFileSync(new URL("../src/hooks/useFeedActions.ts", import.meta.url), "utf8");
  assert.match(hook, /staleTime: 30_000/);
  assert.match(hook, /50/);
  assert.match(hook, /preserveExisting: true/);
  assert.match(hook, /navigator\.share/);
  assert.match(readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8"), /path="\/dashboard\/saved"/);
});
```

`card(item, opts)` gains the optional engagement, saved and library inputs. The test passes them through a seeded `QueryClient` or props, whichever `FeedCard`'s final shape takes.

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **FeedCard footer**: like (heart icon and count, `aria-pressed`), comments (bubble and count; it opens Task 12b's sheet and is disabled until then), a spacer, then Share. Every one is a 44px `rounded-full` button.
  - **FeedCard header**: a 44px Save button (bookmark, `aria-pressed`).
  - **Book preview**: **Want to read** (`BUTTON_SECONDARY`), or "Open in your shelf →" when `readingShelfBook` finds the book.
  - **SavedPage**: `<Page title="Saved" back={{ to: "/dashboard", label: "Home" }}>` listing `fetchSavedContent` pages as `FeedCard`s, without comment counts since saved ids have no thread. Empty: `EmptyState`.
  - **HomePage**: a Saved icon button (`toolbarIconClass()`, `aria-label="Saved"`) linking to `/dashboard/saved` in `actions`.
- [ ] **Step 4: Run** the tests and the Verify line.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/community.ts frontend/src/hooks/useFeedActions.ts frontend/src/components/home/FeedCard.tsx frontend/src/pages/SavedPage.tsx frontend/src/App.tsx frontend/src/pages/HomePage.tsx frontend/scripts/test-feed-card.mts && git commit -m "Let readers like, save, share and add books from the feed"
```

### Task 12b: Comments sheet

**Files:**
- Modify: `frontend/src/api/community.ts`
- Create: `frontend/src/components/home/CommentsSheet.tsx`
- Modify: `frontend/src/components/home/FeedCard.tsx`
- Test: `frontend/scripts/test-feed-card.mts`

**Interfaces:**
- Consumes: `fetchActivityComments(id, cursor?)`, `addActivityComment(id, text)`, `deleteActivityComment(commentId)` (`packages/shared/src/community/api.ts:16-22`), bound in `frontend/src/api/community.ts`; `Sheet`; `FIELD_CLASS`; `useConfirm`.
- Produces `CommentsSheet({ id, title, onClose }: { id: string; title: string; onClose: () => void })`, a port of the app's `CommentsSheet` (`mobile/src/features/home/CommentsSheet.tsx:15`).
  - The list is an infinite query with key `["community","comments", id]`.
  - The composer is a labelled textarea with `FIELD_CLASS` and a Post `BUTTON_PRIMARY` in the sheet footer.
  - Delete is shown only on your own comments and asks first.
  - Any change invalidates `["community","engagement"]`.
  - A 429 from the 30/min comment limit shows a toast saying to wait a moment.

- [ ] **Step 1: Write the failing test.**

```ts
test("comments: both shown, delete only on your own, a labelled composer with one Post button", () => {
  const html = comments("a1", [{ id: "c1", author: alice, text: "Loved it", createdAt: "2026-10-29T10:00:00Z", own: false }, { id: "c2", author: me, text: "Same", createdAt: "2026-10-29T11:00:00Z", own: true }]);
  assert.match(html, /Loved it[\s\S]*Same/);
  assert.equal(html.match(/>Delete</g)?.length, 1);
  assert.match(html, /<label[^>]*for="[^"]+"[^>]*>[^<]*Comment/);
  assert.match(html, /<textarea[^>]*id="/);
  assert.equal(html.match(/>Post</g)?.length, 1);
});
```

`comments(id, list)` renders `CommentsSheet` with a `QueryClient` seeded at `["community","comments", id]` in the infinite-query shape.

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the sheet, and enable the FeedCard comment button so it opens it.
- [ ] **Step 4: Run** the test and the Verify line.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/community.ts frontend/src/components/home/CommentsSheet.tsx frontend/src/components/home/FeedCard.tsx frontend/scripts/test-feed-card.mts && git commit -m "Open feed comments in a sheet"
```

### Task 12c: Phase 3b browser pass and PR

- [ ] Same steps as Task 5. Cover:
  - like and unlike;
  - save, then the Saved page;
  - share (in the preview browser, the clipboard fallback shows its error toast; that is expected there);
  - Want to read, then the book appearing in the library;
  - posting and deleting a comment.

Run every action against the fixture account only.

---

## Phase 4 — Community and Games (PR 5)

### Task 13: Discover and People

**Files:**
- Modify: `frontend/src/pages/DiscoverPage.tsx`
- Modify: `frontend/src/pages/PeoplePage.tsx`
- Test: `frontend/scripts/test-community-helpers.mts`

**Interfaces:**
- Consumes: `FIELD_CLASS`, `chipClass`, `PANEL`, `LIST_PANEL`, `BUTTON_SECONDARY`.

- [ ] **Step 1: Write the failing test.**

```ts
test("Discover filters with chips and People shows person cards with secondary Follow", () => {
  const read = (f: string) => readFileSync(new URL(`../src/pages/${f}.tsx`, import.meta.url), "utf8");
  const discover = read("DiscoverPage");
  assert.match(discover, /chipClass\(/);
  assert.match(discover, /aria-pressed=/);
  assert.match(discover, /FIELD_CLASS/);
  assert.doesNotMatch(discover, /const searchInput/);
  const people = read("PeoplePage");
  assert.match(people, /FIELD_CLASS/);
  assert.match(people, /PANEL/);
  assert.doesNotMatch(people, /BUTTON_PRIMARY/);
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Discover:** a toolbar row with the search field (`FIELD_CLASS`, leading icon, `sm:w-85`) and type chips (All · Tier lists · Tournaments · Quizzes) replacing the current filter control, keeping its state and query parameters. `GameTicket` grid unchanged.
  - **People:** search with `FIELD_CLASS`. "Readers you might like" becomes a grid (`[grid-template-columns:repeat(auto-fill,minmax(280px,1fr))] gap-4`) of `PANEL p-4` person cards: 48px `Avatar`, name, reason line, the existing shared-covers strip, and Follow with `BUTTON_SECONDARY`. Other lists on the page become `LIST_PANEL`.
- [ ] **Step 4: Run** the test and the Verify line, then check both pages in the browser.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DiscoverPage.tsx frontend/src/pages/PeoplePage.tsx frontend/scripts/test-community-helpers.mts && git commit -m "Restyle Discover filters and People as cards"
```

### Task 14: Profile header

**Files:**
- Modify: `frontend/src/pages/CommunityProfilePage.tsx`
- Modify: `frontend/src/components/OwnShelfView.tsx`
- Modify: `frontend/src/components/SwipeTabs.tsx`
- Test: `frontend/scripts/test-page-frame.mts`

**Interfaces:**
- Consumes: `Page` with `title={null}` and `back={backTo("profile")}` (Task 3), `LIST_PANEL`.

- [ ] **Step 1: Write the failing test** (update the "Home, Murals, Reader card and profiles use Page" test).

```ts
for (const file of ["pages/CommunityProfilePage", "components/OwnShelfView"]) {
  const src = read(`${file}.tsx`);
  assert.match(src, /title=\{null\}/, file);
  assert.match(src, /<h1[^>]*font-display/, file);
  assert.doesNotMatch(src, /max-w-(3xl|4xl)/, file);
}
```

The test asserts `<h1>` *is* present now. Delete the old `assert.doesNotMatch(read("components/OwnShelfView.tsx"), /<h1/)`.

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The profile header: `flex flex-wrap items-center gap-5` with a 72px `Avatar`, the `h1` (`font-display text-3xl font-bold lg:text-[2.5rem]`, `@username`, `break-words`) and the existing one-line facts, plus the primary action on the right (Follow or Following via its current component, or the owner's existing action).
  - Mural, Activity and Library are underline tabs at `lg` (the same classes as `Page` tabs, as buttons with `aria-current`), and `SwipeTabs` stays below `lg`.
  - Published games become a `LIST_PANEL`.
  - Remove the inner `max-w-3xl`/`max-w-4xl` wrappers. The page width is `default`.
- [ ] **Step 4: Run** the test and the Verify line. In the browser, check your own profile and `fixture_alice`'s at 1440 and 390; the mural block must not overflow.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/CommunityProfilePage.tsx frontend/src/components/OwnShelfView.tsx frontend/src/components/SwipeTabs.tsx frontend/scripts/test-page-frame.mts && git commit -m "Give profiles a header with the follow action"
```

### Task 15: Games list and game pages

**Files:**
- Modify: `frontend/src/pages/ArenaListPage.tsx`
- Modify: `frontend/src/pages/ArenaViewPage.tsx`
- Modify: `frontend/src/pages/ArenaSeedPage.tsx`
- Modify: `frontend/src/pages/TierListEditorPage.tsx`
- Modify: `frontend/src/pages/VoteTierlistPage.tsx`
- Modify: `frontend/src/pages/TierListCreatePage.tsx`
- Modify: `frontend/src/pages/QuizCreatePage.tsx`
- Modify: `frontend/src/pages/QuizEditorPage.tsx`
- Modify: `frontend/src/pages/PlayQuizPage.tsx`
- Modify: `frontend/src/components/quiz/QuizResults.tsx`
- Test: `frontend/scripts/test-page-frame.mts`

**Interfaces:**
- Consumes: `Page` widths, `BUTTON_PRIMARY`, `FIELD_CLASS`, `EmptyState`.

- [ ] **Step 1: Write the failing test.**

```ts
test("Games pages: one primary in the header, no hand-rolled fills, no inner widths, a centred tournament", () => {
  const read = (f: string) => readFileSync(new URL(`../src/${f}.tsx`, import.meta.url), "utf8");
  const list = read("pages/ArenaListPage");
  assert.match(list, /actions=\{[\s\S]*?BUTTON_PRIMARY/);
  assert.match(list, /subtitle=\{/);
  for (const f of ["pages/TierListCreatePage", "pages/QuizCreatePage", "pages/QuizEditorPage", "pages/PlayQuizPage", "components/quiz/QuizResults"]) {
    const s = read(f);
    assert.doesNotMatch(s, /mx-auto[^"`]*max-w-(xl|2xl|3xl|6xl)\b|max-w-(xl|2xl|3xl|6xl)\b[^"`]*mx-auto/, f);
    assert.doesNotMatch(s, /<button\b(?:[^>]|=>)*className=\{?[`"][^`"]*bg-\(--color-accent\)/, f);
  }
  assert.match(read("pages/ArenaViewPage"), /<EmptyState/);
});
```

The started tournament's left-hugging column has no single class to assert, so the browser check in Step 4 covers it.

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **List:** the primary for the current tab goes in `actions` ("New tier list", "New quiz" or "New tournament", with today's handlers), and the intro line becomes `subtitle`.
  - **Game pages:**
    - Hand-rolled accent buttons become `BUTTON_PRIMARY`, keeping one per view.
    - Fields become `FIELD_CLASS`.
    - Remove inner widths, since Task 3's `width` now governs.
    - The started tournament (`ArenaViewPage`) drops its left-hugging wrapper so the bracket centres in `default`, and its empty bypass (`:189`) becomes `EmptyState`.
    - The seed page keeps "Start tournament" as its one primary.
- [ ] **Step 4: Run** the test and the Verify line. In the browser, check the three list tabs (empty and filled), a tier list editor, a vote link, a quiz editor, a quiz play and results, and a started tournament at 1440 and 390.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ArenaListPage.tsx frontend/src/pages/ArenaViewPage.tsx frontend/src/pages/ArenaSeedPage.tsx frontend/src/pages/TierListEditorPage.tsx frontend/src/pages/VoteTierlistPage.tsx frontend/src/pages/TierListCreatePage.tsx frontend/src/pages/QuizCreatePage.tsx frontend/src/pages/QuizEditorPage.tsx frontend/src/pages/PlayQuizPage.tsx frontend/src/components/quiz/QuizResults.tsx frontend/scripts/test-page-frame.mts && git commit -m "Move Games actions into the header and centre game pages"
```

### Task 16: Phase 4 browser pass and PR

- [ ] Same steps as Task 5, over the pages from Tasks 13–15.

---

## Phase 5 — Murals, Reader card, Settings, Admin, public pages (PR 6)

### Task 17: Murals list and editor header

**Files:**
- Modify: `frontend/src/pages/MuralsListPage.tsx`
- Modify: `frontend/src/pages/MuralEditorPage.tsx`
- Test: `frontend/scripts/test-murals.mts`

- [ ] **Step 1: Write the failing test.**

```ts
test("Murals: preset and new mural in the header, a folder column, tiles as panels", () => {
  const list = readFileSync(new URL("../src/pages/MuralsListPage.tsx", import.meta.url), "utf8");
  assert.match(list, /actions=\{[\s\S]*?Start from a preset[\s\S]*?New mural/);
  assert.match(list, /lg:grid-cols-\[220px_minmax\(0,1fr\)\]/);
  assert.match(list, /PANEL/);
  assert.doesNotMatch(list, /uppercase/);
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - "Start from a preset" (`BUTTON_SECONDARY`, opening the existing preset chooser) and "New mural" (`BUTTON_PRIMARY`) go in `actions`, and the full-width preset bar goes.
  - At `lg`, a `220px` folder list of 44px rows (`accent-soft` for the current one) beside the main column. The main column holds the search and sort toolbar (`FIELD_CLASS`, sentence-case labels) and the tile grid. Each tile is a `PANEL p-4` with name, "My shelf" chip, block count and date, and its `OptionsMenu`.
  - Editor: the header keeps `back={backTo("mural")}`, the rename title and **Done editing** as its only primary. The canvas width is unchanged.
- [ ] **Step 4: Run** the test and the Verify line, then check the list and the editor (view and edit mode) in the browser.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/MuralsListPage.tsx frontend/src/pages/MuralEditorPage.tsx frontend/scripts/test-murals.mts && git commit -m "Restyle the murals list with a folder column"
```

### Task 18: Reader card layout

**Files:**
- Modify: `frontend/src/pages/ReaderCardPage.tsx`
- Test: `frontend/scripts/test-reader-card-editor.mts`

- [ ] **Step 1: Write the failing test.**

```ts
test("preview sticks under the bar beside the controls at lg; no inner page width", () => {
  const page = readFileSync(new URL("../src/pages/ReaderCardPage.tsx", import.meta.url), "utf8");
  assert.match(page, /lg:grid-cols-\[minmax\(0,5fr\)_minmax\(0,7fr\)\]/);
  assert.match(page, /lg:sticky lg:top-\[calc\(var\(--app-top\)\+1\.5rem\)\]/);
  assert.doesNotMatch(page, /max-w-7xl/);
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use the two-column grid, with the preview column sticky at `lg`. Control groups get `PANEL_HEADING` headings, and the existing pickers stay.
- [ ] **Step 4: Run** the test and the Verify line, then check in the browser at 1440 and 390.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ReaderCardPage.tsx frontend/scripts/test-reader-card-editor.mts && git commit -m "Pin the reader card preview beside its controls"
```

### Task 19: Settings side navigation and setting rows

**Files:**
- Modify: `frontend/src/components/page/Page.tsx`
- Modify: `frontend/src/pages/SettingsPage.tsx`
- Modify: `frontend/src/pages/SettingsAppearancePage.tsx`
- Modify: `frontend/src/pages/LibraryStylePage.tsx`
- Modify: `frontend/src/auth/AccountSecuritySection.tsx`
- Modify: `frontend/src/components/SocialsSection.tsx`
- Modify: `frontend/src/auth/DeleteAccountSection.tsx`
- Modify: `frontend/src/lib/areas.ts`
- Test: `frontend/scripts/test-page-frame.mts`
- Test: `frontend/scripts/test-controls.mts`
- Test: `frontend/scripts/test-areas.mts`

**Interfaces:**
- Produces: a `Page` prop `sideTabs?: boolean`. With tabs and `sideTabs`, below `lg` it renders the normal tab row (`lg:hidden`). At `lg` it renders a two-column body, `lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12`, with a vertical `nav aria-label="Sections"` (`hidden lg:flex flex-col gap-0.5`; 44px rows, `rounded-lg px-3.5`, the current one `bg-(--color-accent-soft) text-(--color-accent)` with `aria-current`) and the children in `max-w-3xl`.
- Settings' Style tab label becomes "Library style" in `areas.ts`.

- [ ] **Step 1: Write the failing tests.**

```ts
// test-page-frame.mts
test("side tabs: a row below lg, a vertical nav from lg, current marked in both", () => {
  const html = render(createElement(Page, { title: "Settings", tabs: area("settings").tabs, sideTabs: true, children: "BODY" }), "/dashboard/settings");
  assert.match(html, /<nav aria-label="Sections"[^>]*lg:hidden/);
  assert.match(html, /<nav aria-label="Sections"[^>]*hidden lg:flex/);
  assert.equal(html.match(/aria-current="page"/g)?.length, 2);
  assert.match(html, /max-w-3xl[^>]*>BODY/);
});

test("all Settings tabs use side tabs", () => {
  for (const f of ["SettingsPage", "SettingsAppearancePage", "LibraryStylePage"]) assert.match(readFileSync(new URL(`../src/pages/${f}.tsx`, import.meta.url), "utf8"), /sideTabs/, f);
});
```

```ts
// test-areas.mts
test("the Settings tabs read Account, Appearance, Library style", () => {
  assert.deepEqual(area("settings").tabs.map((t) => t.label), ["Account", "Appearance", "Library style"]);
});
```

```ts
// test-controls.mts: replace the Settings "Change" assertion
test("Settings rows name their object and meet the floor", () => {
  const s = src("pages/SettingsPage");
  assert.match(s, />\s*Change picture\s*</);
  assert.match(s, />\s*Change username\s*</);
  assert.doesNotMatch(s, />\s*Change\s*</);
  assert.match(s, /LIST_PANEL/);
  assert.match(src("auth/DeleteAccountSection"), /BUTTON_DANGER_OUTLINE/);
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `sideTabs` in `Page`.
  - Remove the Settings pages' inner `max-w-xl`.
  - Account becomes groups: each a `PANEL_HEADING` plus an optional `text-dim` description, then a `LIST_PANEL` whose rows have a label and description on the left and the control on the right. The groups are Profile (picture, username), Sign-in and email (`AccountSecuritySection`), Socials (`SocialsSection`) and Delete account (`DeleteAccountSection`, with `BUTTON_DANGER_OUTLINE` opening its existing confirm; the confirming button inside stays `BUTTON_DANGER`).
  - Rename the buttons as the test pins.
  - Appearance and Style keep their controls inside the content column.
- [ ] **Step 4: Run** the tests and the Verify line. In the browser, check each tab at 1440 and 390, and confirm the change-username, change-password and delete-account flows still open.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/page/Page.tsx frontend/src/pages/SettingsPage.tsx frontend/src/pages/SettingsAppearancePage.tsx frontend/src/pages/LibraryStylePage.tsx frontend/src/auth/AccountSecuritySection.tsx frontend/src/components/SocialsSection.tsx frontend/src/auth/DeleteAccountSection.tsx frontend/src/lib/areas.ts frontend/scripts/test-page-frame.mts frontend/scripts/test-controls.mts frontend/scripts/test-areas.mts && git commit -m "Give Settings a side navigation and setting rows"
```

### Task 20: Admin queues and Not found

**Files:**
- Modify: `frontend/src/components/GenreReviewList.tsx`
- Modify: `frontend/src/components/SynopsisReviewList.tsx`
- Modify: `frontend/src/components/TranslationReviewList.tsx`
- Modify: `frontend/src/pages/NotFoundPage.tsx`
- Test: `frontend/scripts/test-admin-genres.mts`

- [ ] **Step 1: Write the failing test.**

```ts
test("review queues are list panels; Not found uses the shared primary", () => {
  const read = (f: string) => readFileSync(new URL(`../src/${f}.tsx`, import.meta.url), "utf8");
  for (const f of ["components/GenreReviewList", "components/SynopsisReviewList", "components/TranslationReviewList"]) assert.match(read(f), /LIST_PANEL/, f);
  assert.match(read("pages/NotFoundPage"), /BUTTON_PRIMARY/);
});
```

The admin pages already show `EmptyState` when a queue is empty (`AdminGenresPage.tsx:24`, `AdminSynopsesPage.tsx:23`, `AdminTranslationsPage.tsx:23`), so that part stays as it is.

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The queues become `LIST_PANEL` rows.
  - Not found keeps its centred copy with `BUTTON_PRIMARY`.
- [ ] **Step 4: Run** the test and the Verify line. Check the three admin tabs in the browser, and a shared mural signed in and signed out, since Tasks 2–4 changed its frame.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/GenreReviewList.tsx frontend/src/components/SynopsisReviewList.tsx frontend/src/components/TranslationReviewList.tsx frontend/src/pages/NotFoundPage.tsx frontend/scripts/test-admin-genres.mts && git commit -m "Restyle admin queues and Not found"
```

### Task 21: Phase 5 browser pass and PR

- [ ] Same steps as Task 5, over the pages from Tasks 17–20.

---

## Phase 6 — Sweep, docs, screenshots (PR 7)

### Task 22: Control sweep

**Files:**
- Create: `frontend/scripts/test-control-sweep.mts`
- Modify: `frontend/src/components/AddBookModal.tsx`
- Modify: `frontend/src/components/ShareModal.tsx`
- Modify: `frontend/src/components/FinishSheet.tsx`

- [ ] **Step 1: Write the guard test.** It scans every `frontend/src/**/*.tsx` except `components/landing/**` and the class modules.

```ts
test("no button or link hand-rolls an accent or danger fill", () => {
  const offenders = files().filter((f) => /<(button|Link|a)\b(?:[^>]|=>)*className=\{?[`"][^`"]*bg-\(--color-(accent|danger)\)[^`"]*text-\(--color-on-(accent|danger)\)/s.test(read(f)));
  assert.deepEqual(offenders, []);
});

test("no text field hand-rolls the field chrome", () => {
  const offenders = files().filter((f) => /<(input|select|textarea)\b(?!(?:[^>]|=>)*type="(checkbox|radio|range|file|color)")(?:[^>]|=>)*className=\{?[`"][^`"]*border border-\(--color-border\)[^`"]*bg-\(--color-surface\)/s.test(read(f)));
  assert.deepEqual(offenders, []);
});
```

Before fixing anything, check the guards against today's code. They must flag `AddBookModal.tsx`, `ShareModal.tsx` and `FinishSheet.tsx`, which hand-roll field chrome after an inline arrow handler. If a guard misses them, fix its regex first.

- [ ] **Step 2: Run.** Expected: FAIL, listing the files still hand-rolling.
- [ ] **Step 3: Fix** every offender with `BUTTON_PRIMARY`/`BUTTON_DANGER`/`FIELD_CLASS`. Add each file you touch to this task's Files list and commit command; the three named are the known ones (`AddBookModal.tsx:312-372`).
- [ ] **Step 4: Run** the guard and the Verify line.
- [ ] **Step 5: Commit**

```bash
git add frontend/scripts/test-control-sweep.mts frontend/src/components/AddBookModal.tsx frontend/src/components/ShareModal.tsx frontend/src/components/FinishSheet.tsx && git commit -m "Route the remaining buttons and fields through the shared classes"
```

### Task 23: Docs

**Files:**
- Modify: `DESIGN.md`
- Modify: `frontend/README.md`

- [ ] **Step 1:** In `DESIGN.md`, rewrite "Layout", "The frame", "Page frame (web)", the web control rules and "Brand lockup"'s sidebar mention to match what shipped: the top bar, the page header, the widths, the panel and list rules, the book-style cover and its shadow, the control classes and `sideTabs`. Correct `frontend/README.md:7,17,58`.
- [ ] **Step 2: Verify** with `npm run check:agents` (it reads the root docs) and the Verify line.
- [ ] **Step 3: Commit**

```bash
git add DESIGN.md frontend/README.md && git commit -m "Document the revamped web frame"
```

### Task 24: Landing screenshots, PR, hand-off

- [ ] **Step 1:** `npm run screenshots:landing --workspace frontend` (needs network). Check the four `frontend/public/landing/*.webp` files show the new Library and Home, then commit them.
- [ ] **Step 2:** Run `branch-reviewer`, Codex and the Verify line, then open the PR with auto-merge.
- [ ] **Step 3:** Tell the user the revamp is merged and not deployed (deploys are theirs). Ask them to dispatch `site-ui-reviewer` for the final sweep. Offer to update the live design-system artifact from the new `DESIGN.md`.
