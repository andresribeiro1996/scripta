# Site Page Frame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every web page sits in one frame: a sidebar of areas, plus a header band with title, subtitle, actions and (for areas with sibling pages) tabs. Public pages get the band without the sidebar. One rule each covers buttons, touch targets, dialogs, empty states, fields and label case.

**Architecture:**
- `lib/areas.ts` is the single source of the area/tab map, back-link targets and route→area lookup.
- `components/page/Page.tsx` renders the band and the width-bound body. It reads the page width from a context that the signed-in shell fills from the user's `contentMaxWidth`.
- `DashboardLayout` builds its sidebar, bottom bar and drawer from `AREAS`. A new `PublicLayout` frames share and signed-out pages. `SessionLayout` picks between the two for routes that serve both.
- Pages then move onto `Page` area by area.

**Tech Stack:** React 19, React Router, Tailwind v4, TanStack Query, `node:test` via `tsx` with `react-dom/server` `renderToString` (the existing `frontend/scripts/test-*.mts` style).

**Spec:** `docs/superpowers/specs/2026-10-25-site-page-frame-design.md`

## Global Constraints

- **Sidebar areas, in order:** Home, Library, Murals, Games, Reader card, Community, Settings.
- **Admin** (admins only) is not in that list. It is one "Admin" link to `/admin/genres` in the sidebar and drawer footer, above Log out, where `AdminLinks` sits today (spec).
- **Phone bottom bar:** Home, Library, Murals, Games, then More. The drawer lists every area plus the footer.
- **Tabs:**
  - Library: Books · Series · Collections · Gallery
  - Games: Tier lists · Quizzes · Tournaments
  - Community: Discover · People
  - Settings: Account · Appearance · Style
  - Admin: Genres · Synopses · Translations
  - Home, Murals and Reader card have none.
- **Single items** (tier list, quiz, tournament, seed page, mural, Work/book page, community profile) get a back link named after the area ("‹ Games"), and never get tabs.
- **"Games"** in every visible string. Routes keep `/arena`.
- **No existing route, query parameter (`?tab=`, `?action=`) or share-link format changes.** The one new address is `/dashboard/settings/appearance` (Ruling: route-based, so the Settings tab is an ordinary link).
- **Title:** the page's only `h1`, using the `font-display` utility (`--font-display` in `src/themes.css`), `text-2xl` (24/30), `sm:text-3xl`. Subtitle `text-sm text-(--color-text-dim)`.
- **Rename-in-place titles** (mural, tier list, seed page, tournament) keep working: `Page`'s `title` is a `ReactNode`, and those pages pass their existing rename button or input as the title, inside the `h1`.
- **Body padding** is `px-4 py-5 sm:px-5 sm:py-8`, the same as `PageContainer` today, because `ToolbarRow`'s sticky phone offsets (`components/Toolbar.tsx:27`) depend on it.
- **Band:** `bg-(--color-surface)` with `border-b border-(--color-border)`. Tokens only, no hex values. Every theme must still work.
- **Active tab:** `text-(--color-text)` plus `border-b-2 border-(--color-accent)`, and `aria-current="page"`. Other tabs: `text-(--color-text-dim)`.
- **Body width:** the user's `contentMaxWidth` (default `DEFAULT_LIBRARY_STYLE.contentMaxWidth`, 1152) on every signed-in page. Public pages use the default, and the shared library uses the owner's value. Mural canvases keep their own saved width, centred.
- **Phone (<`sm`):** the title is never hidden, actions wrap under it, and tabs are one horizontally scrolling row. The bottom tab bar and More drawer stay.
- **Touch targets:** every tappable control is ≥ 44×44 CSS px (`min-h-11`/`h-11 w-11`).
- **Buttons:** one accent button per view, and every other button uses the one secondary style. The mural editor's accent is "Done editing", the seed page's is "Start tournament".
- **Dialogs:** one shape (`Sheet`): title on the left at `text-lg font-bold`, a 44px "×" labelled "Close" on the right, and a footer with Cancel plus one primary button when the dialog commits something. Never both "Close" and Cancel.
- **Empty states:** `components/EmptyState.tsx`. Labels in sentence case everywhere; mural block headings are the exception. The overflow menu uses the three-dot glyph, and a settings action uses `SettingsIcon`.
- **Repo rules:** no comments in code, minimum code, reuse `@scripta/shared` and existing components. Verify with `npm run typecheck --workspace frontend`, `npm run lint --workspace frontend` and `npm test --workspace frontend`.
- **Manual checks** use `node scripts/dev-web.mjs --reset` and `node scripts/web-snapshot.mjs` at `--width 1280` and `--width 360`, then `npm run dev:release`. Never release another worktree's stack.
- **Ship in three PRs** (the phase headings below), each with auto-merge. Phase 1 must land whole, because the new sidebar drops Series, Collections and Gallery, which are reachable only through Library's tabs.

## Review Focus

1. **A deep link with an unknown `?tab=`** (`/dashboard/arena?tab=bogus`) should highlight Tournaments, as the page itself treats it. Pinned in Task 1's `activeTabTo` test.
2. **A non-admin** should see no Admin entry in the sidebar, drawer or bottom bar. Pinned in Task 1's `footerAreas(false)` test and Task 3's `SidebarNav` test.
3. **A signed-out visitor to `/work/:id`** should get no sidebar, a "Log in" link, and no back link into the signed-in library. A signed-in one should get the sidebar with Library highlighted. Pinned in Task 9's `PublicLayout` test and `areaIdForPath("/work/x")` in Task 1.
4. **A 60-character title at 360px** (a long mural or tournament name) should wrap inside the band and never widen the page. Pinned in Task 2's test (`min-w-0 break-words` on the title column) and Task 7's 360px check.
5. **Old bookmarks** should keep working:
   - `/dashboard/settings` opens Account.
   - `/dashboard/style` opens Style with the Settings tabs.
   - `/dashboard/series`, `/dashboard/collections`, `/dashboard/gallery` open with the Library tabs.
   Pinned in Task 1's tab tests and Task 6's manual check.

---

## Phase 1: frame, shell and the tabbed areas (PR 1)

### Task 1: The area map

**Files:**
- Create: `frontend/src/lib/areas.ts`
- Test: `frontend/scripts/test-areas.mts`

**Interfaces:**
- Produces:
  ```ts
  export type AreaId = "home" | "library" | "murals" | "games" | "readerCard" | "community" | "settings" | "admin";
  export interface AreaTab { label: string; to: string }
  export interface Area { id: AreaId; label: string; to: string; tabs: readonly AreaTab[]; description?: string }
  export const AREAS: readonly Area[];
  export function area(id: AreaId): Area;
  export const NAV_AREAS: readonly Area[];      // the seven sidebar areas, Admin excluded
  export function footerAreas(isAdmin: boolean): Area[]; // [area("admin")] or []
  export const BOTTOM_BAR_AREAS: readonly AreaId[]; // ["home", "library", "murals", "games"]
  export function areaIdForPath(pathname: string): AreaId | null;
  export function activeTabTo(tabs: readonly AreaTab[], location: { pathname: string; search: string }): string | null;
  export type BackKind = "tierlist" | "quiz" | "tournament" | "mural" | "book" | "profile";
  export function backTo(kind: BackKind): { to: string; label: string };
  ```

- [ ] **Step 1: Write the failing tests** in `frontend/scripts/test-areas.mts`.

```ts
test("areas come in sidebar order; Admin sits in the footer, for admins only", () => {
  assert.deepEqual(NAV_AREAS.map((a) => a.label), ["Home", "Library", "Murals", "Games", "Reader card", "Community", "Settings"]);
  assert.deepEqual(footerAreas(false), []);
  assert.deepEqual(footerAreas(true).map((a) => [a.label, a.to]), [["Admin", "/admin/genres"]]);
  assert.deepEqual(BOTTOM_BAR_AREAS, ["home", "library", "murals", "games"]);
});

test("tabs carry today's routes", () => {
  assert.deepEqual(area("library").tabs.map((t) => [t.label, t.to]), [["Books", "/dashboard/library"], ["Series", "/dashboard/series"], ["Collections", "/dashboard/collections"], ["Gallery", "/dashboard/gallery"]]);
  assert.deepEqual(area("games").tabs.map((t) => [t.label, t.to]), [["Tier lists", "/dashboard/arena?tab=tierlists"], ["Quizzes", "/dashboard/arena?tab=quizzes"], ["Tournaments", "/dashboard/arena"]]);
  assert.deepEqual(area("settings").tabs.map((t) => t.to), ["/dashboard/settings", "/dashboard/settings/appearance", "/dashboard/style"]);
  assert.deepEqual(area("community").tabs.map((t) => t.to), ["/community/discover", "/community/people"]);
  assert.deepEqual(area("admin").tabs.map((t) => t.to), ["/admin/genres", "/admin/synopses", "/admin/translations"]);
  assert.deepEqual([area("home").tabs, area("murals").tabs, area("readerCard").tabs], [[], [], []]);
});

test("the active tab follows path and ?tab=, unknown tabs fall back to the plain path", () => {
  const games = area("games").tabs;
  assert.equal(activeTabTo(games, { pathname: "/dashboard/arena", search: "" }), "/dashboard/arena");
  assert.equal(activeTabTo(games, { pathname: "/dashboard/arena", search: "?tab=quizzes" }), "/dashboard/arena?tab=quizzes");
  assert.equal(activeTabTo(games, { pathname: "/dashboard/arena", search: "?tab=bogus" }), "/dashboard/arena");
  assert.equal(activeTabTo(area("settings").tabs, { pathname: "/dashboard/style", search: "" }), "/dashboard/style");
  assert.equal(activeTabTo(area("library").tabs, { pathname: "/dashboard/murals", search: "" }), null);
});

test("every route maps to the area that owns it", () => {
  const cases: Array<[string, AreaId | null]> = [
    ["/dashboard", "home"], ["/dashboard/library", "library"], ["/dashboard/gallery", "library"], ["/work/w1", "library"], ["/work/w1/stats", "library"], ["/book/isbn:1", "library"], ["/dashboard/libraryx", null],
    ["/dashboard/murals", "murals"], ["/dashboard/murals/m1", "murals"],
    ["/dashboard/arena", "games"], ["/dashboard/arena/quiz/q1", "games"], ["/dashboard/arena/t1/seed", "games"], ["/arena/t1", "games"],
    ["/dashboard/reader-card", "readerCard"], ["/community/people", "community"], ["/community/u/alice", "community"],
    ["/dashboard/settings/appearance", "settings"], ["/dashboard/style", "settings"], ["/admin/synopses", "admin"], ["/login", null]
  ];
  for (const [path, id] of cases) assert.equal(areaIdForPath(path), id, path);
});

test("back links go to the tab the item belongs to", () => {
  assert.deepEqual(backTo("tierlist"), { to: "/dashboard/arena?tab=tierlists", label: "Games" });
  assert.deepEqual(backTo("quiz"), { to: "/dashboard/arena?tab=quizzes", label: "Games" });
  assert.deepEqual(backTo("tournament"), { to: "/dashboard/arena", label: "Games" });
  assert.deepEqual(backTo("mural"), { to: "/dashboard/murals", label: "Murals" });
  assert.deepEqual(backTo("book"), { to: "/dashboard/library", label: "Library" });
  assert.deepEqual(backTo("profile"), { to: "/community/discover", label: "Community" });
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd frontend && npx tsx --tsconfig tsconfig.app.json --test scripts/test-areas.mts`
Expected: FAIL, the module is not found.

- [ ] **Step 3: Implement `frontend/src/lib/areas.ts`** with the interfaces above. `activeTabTo` matches the tab whose path equals `pathname` and whose `tab` query equals the location's. If none matches, it falls back to the tab with that path and no query. `areaIdForPath` is a table of path prefixes matched on whole segments, so `/dashboard/libraryx` matches nothing. `description` carries today's drawer descriptions (Murals "Freeform dashboard pages", Games "Book-bracket tournaments").

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd frontend && npx tsx --tsconfig tsconfig.app.json --test scripts/test-areas.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/areas.ts frontend/scripts/test-areas.mts && git commit -m "Add the web area map: areas, tabs, back links"
```

### Task 2: `Page`, the header band and body

**Files:**
- Create: `frontend/src/components/page/Page.tsx`
- Create: `frontend/src/components/page/buttonClasses.ts`
- Test: `frontend/scripts/test-page-frame.mts`

**Interfaces:**
- Consumes: `AreaTab`, `activeTabTo` (Task 1).
- Produces:
  ```ts
  export const PageWidthContext: React.Context<number>; // default DEFAULT_LIBRARY_STYLE.contentMaxWidth
  export function Page(props: {
    title: ReactNode; // a string, or a page's rename button/input
    subtitle?: ReactNode;
    back?: { to: string; label: string };
    actions?: ReactNode;
    tabs?: readonly AreaTab[];
    maxWidth?: number;
    children: ReactNode;
  }): JSX.Element;
  export const BUTTON_PRIMARY: string;   // accent fill, on-accent text, min-h-11, rounded-lg, px-4, text-sm font-semibold
  export const BUTTON_SECONDARY: string; // surface + border, hover surface-hover, same box
  ```

- [ ] **Step 1: Write the failing tests** in `frontend/scripts/test-page-frame.mts`. Render with `renderToString` inside `MemoryRouter`, the way `scripts/test-phone-layout.mts` does.

```ts
const render = (el: ReactElement, path = "/dashboard/arena?tab=quizzes", width?: number) =>
  renderToString(createElement(MemoryRouter, { initialEntries: [path] },
    width === undefined ? el : createElement(PageWidthContext.Provider, { value: width }, el)));

test("one display-font h1 in a surface band", () => {
  const html = render(createElement(Page, { title: "Games", children: "x" }));
  assert.equal(html.match(/<h1/g)?.length, 1);
  assert.match(html, /<h1 class="[^"]*font-display[^"]*text-2xl[^"]*sm:text-3xl/);
  assert.match(html, /bg-\(--color-surface\)[^"]*border-b border-\(--color-border\)|border-b border-\(--color-border\)[^"]*bg-\(--color-surface\)/);
});

test("the current tab is marked and every tab is a 44px target", () => {
  const html = render(createElement(Page, { title: "Games", tabs: area("games").tabs, children: "x" }));
  assert.match(html, /<a(?=[^>]*aria-current="page")[^>]*>Quizzes<\/a>/);
  assert.equal(html.match(/aria-current="page"/g)?.length, 1);
  assert.equal(html.match(/<a(?=[^>]*min-h-11)[^>]*>/g)?.length, 3);
});

test("back link names the area and is a 44px target", () => {
  const html = render(createElement(Page, { title: "Summer showdown", back: backTo("tournament"), children: "x" }));
  assert.match(html, /<a(?=[^>]*href="\/dashboard\/arena")(?=[^>]*min-h-11)[^>]*>[\s\S]*?Games<\/a>/);
});

test("a rename control can be the title", () => {
  const html = render(createElement(Page, { title: createElement("button", null, "Summer showdown"), children: "x" }));
  assert.match(html, /<h1[^>]*><button>Summer showdown<\/button><\/h1>/);
});

test("the body keeps PageContainer's padding", () => {
  assert.match(render(createElement(Page, { title: "T", children: "x" })), /px-4 py-5 sm:px-5 sm:py-8/);
});

test("a long title can wrap inside the band", () => {
  const html = render(createElement(Page, { title: "A".repeat(60), children: "x" }));
  assert.match(html, /min-w-0[^"]*break-words|break-words[^"]*min-w-0/);
});

test("body width comes from context, a prop overrides it", () => {
  assert.match(render(createElement(Page, { title: "T", children: "x" }), "/", 1400), /max-width:1400px/);
  assert.match(render(createElement(Page, { title: "T", maxWidth: 900, children: "x" }), "/", 1400), /max-width:900px/);
});

test("button classes meet the 44px floor", () => {
  for (const cls of [BUTTON_PRIMARY, BUTTON_SECONDARY]) assert.match(cls, /min-h-11/);
  assert.match(BUTTON_PRIMARY, /bg-\(--color-accent\)/);
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd frontend && npx tsx --tsconfig tsconfig.app.json --test scripts/test-page-frame.mts`
Expected: FAIL, the module is not found.

- [ ] **Step 3: Implement `Page.tsx` and `buttonClasses.ts`.**
  - The band's inner row uses the same max-width as the body, so the title lines up with the content.
  - Tabs are `Link`s inside `<nav aria-label="Sections">`, with `overflow-x-auto` below `sm`.
  - The back link reuses `ChevronLeftIcon` from `components/Toolbar.tsx`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd frontend && npx tsx --tsconfig tsconfig.app.json --test scripts/test-page-frame.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/page/Page.tsx frontend/src/components/page/buttonClasses.ts frontend/scripts/test-page-frame.mts && git commit -m "Add Page: the header band with tabs and the width-bound body"
```

### Task 3: The shell builds its nav from the areas

**Files:**
- Create: `frontend/src/components/page/SidebarNav.tsx`
- Modify: `frontend/src/layouts/DashboardLayout.tsx`
- Modify: `frontend/src/components/NavIcons.tsx`
- Delete: `frontend/src/components/AdminLinks.tsx`
- Modify: `frontend/scripts/test-admin-genres.mts`
- Modify: `frontend/scripts/test-admin-synopses.mts`
- Modify: `frontend/scripts/test-admin-translations.mts`
- Test: `frontend/scripts/test-sidebar-nav.mts`

**Interfaces:**
- Consumes: `NAV_AREAS`, `footerAreas`, `BOTTOM_BAR_AREAS`, `areaIdForPath` (Task 1), and `PageWidthContext` (Task 2).
- Produces: `SidebarNav({ areas, activeId, homeBadge, onNavigate, withDescriptions }: { areas: readonly Area[]; activeId: AreaId | null; homeBadge?: string | null; onNavigate?: () => void; withDescriptions?: boolean }): JSX.Element`, used for the sidebar, the drawer and the footer Admin link. `homeBadge` renders today's badge and the "Home, N new" `aria-label` on Home.
- Also produces two icons in `NavIcons.tsx`, both hand-authored 24-viewBox stroke SVGs per DESIGN.md Iconography: `HomeIcon` and `ReaderCardIcon`. Area icons:
  - Home: `HomeIcon` (new, so Home and Murals no longer share a glyph in the bottom bar)
  - Library: `LibraryIcon`
  - Murals: `MuralsIcon`
  - Games: `ArenaIcon`
  - Reader card: `ReaderCardIcon`
  - Community: `CommunityIcon`
  - Settings: `SettingsIcon`
  - Admin: `InfoIcon`

- [ ] **Step 1: Write the failing tests** in `frontend/scripts/test-sidebar-nav.mts`.

```ts
const nav = (props: Parameters<typeof SidebarNav>[0]) => renderToString(createElement(MemoryRouter, null, createElement(SidebarNav, props)));

test("lists the areas as 44px links and marks the active one", () => {
  const html = nav({ areas: NAV_AREAS, activeId: "library" });
  assert.equal(html.match(/<a(?=[^>]*min-h-11)[^>]*>/g)?.length, 7);
  assert.match(html, /<a(?=[^>]*aria-current="page")(?=[^>]*href="\/dashboard\/library")[^>]*>/);
  assert.equal(html.match(/aria-current="page"/g)?.length, 1);
  assert.doesNotMatch(html, /Admin/);
});

test("the Home badge and its label survive", () => {
  const html = nav({ areas: NAV_AREAS, activeId: null, homeBadge: "3" });
  assert.match(html, /aria-label="Home, 3 new"/);
});

test("the footer Admin link is a 44px link to the review queues", () => {
  assert.match(nav({ areas: footerAreas(true), activeId: null }), /<a(?=[^>]*href="\/admin\/genres")(?=[^>]*min-h-11)[^>]*>[\s\S]*?Admin/);
  assert.equal(nav({ areas: footerAreas(false), activeId: null }).includes("/admin/"), false);
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd frontend && npx tsx --tsconfig tsconfig.app.json --test scripts/test-sidebar-nav.mts`
Expected: FAIL, the module is not found.

- [ ] **Step 3: Implement `SidebarNav`, then rewire `DashboardLayout`.**
  - `NAV_GROUPS` and `TAB_ITEMS` give way to `NAV_AREAS`.
  - The footer renders `SidebarNav` with `footerAreas(isAdmin)` above Log out, in the sidebar and in the drawer.
  - The active area comes from `areaIdForPath(useLocation().pathname)`, not `NavLink`'s own matching.
  - The bottom bar shows `BOTTOM_BAR_AREAS` plus More, at `h-14`.
  - Keep the Home badge (pass `newCountLabel(personalNewCount)` as `homeBadge`), the avatar/username row, Log out (raise it to `min-h-11`) and `setNavHidden`.
  - Wrap `<Outlet>` in `PageWidthContext.Provider value={resolveLibraryStyle(library?.data.style).contentMaxWidth}`.
  - Delete `AdminLinks.tsx`, since the footer Admin link replaces it. The three admin tests that rendered `AdminLinks` now assert `footerAreas(true)` (and `area("admin").tabs`) holds their page's route, and that `footerAreas(false)` is empty.

- [ ] **Step 4: Run the tests and see them pass, then run the frontend checks**

Run: `cd frontend && npx tsx --tsconfig tsconfig.app.json --test scripts/test-sidebar-nav.mts && npm run typecheck && npm run lint`
Expected: PASS, with no type or lint errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/page/SidebarNav.tsx frontend/src/layouts/DashboardLayout.tsx frontend/src/components/NavIcons.tsx frontend/src/components/AdminLinks.tsx frontend/scripts/test-admin-genres.mts frontend/scripts/test-admin-synopses.mts frontend/scripts/test-admin-translations.mts frontend/scripts/test-sidebar-nav.mts && git commit -m "Build the sidebar, drawer and bottom bar from the area map"
```

### Task 4: Library area on `Page`

**Files:**
- Modify: `frontend/src/pages/LibraryPage.tsx`
- Modify: `frontend/src/pages/GroupsPage.tsx`
- Modify: `frontend/src/pages/GalleryPage.tsx`
- Test: `frontend/scripts/test-page-frame.mts`

**Interfaces:**
- Consumes: `Page`, `BUTTON_PRIMARY`, `BUTTON_SECONDARY` (Task 2), `area("library").tabs` (Task 1).

- [ ] **Step 1: Add a failing source-level guard** to `frontend/scripts/test-page-frame.mts`. It reads each migrated page file and asserts it renders `<Page` with `tabs={area("library").tabs}`, and that it contains no `<h1`/`<h2` page title and no `hidden sm:` on a header:

```ts
test("Library area pages use Page with the Library tabs", () => {
  for (const file of ["LibraryPage", "GroupsPage", "GalleryPage"]) {
    const src = readFileSync(new URL(`../src/pages/${file}.tsx`, import.meta.url), "utf8");
    assert.match(src, /<Page[\s\S]*?tabs=\{area\("library"\)\.tabs\}/, file);
    assert.doesNotMatch(src, /<h2 className="[^"]*text-lg font-bold/, file);
  }
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd frontend && npx tsx --tsconfig tsconfig.app.json --test scripts/test-page-frame.mts`
Expected: FAIL on LibraryPage.

- [ ] **Step 3: Move each page onto `Page`.**
  - **Common to all three:**
    - Title "Library" with the Library tabs.
    - Actions in the band: Library's "Add book" is the one primary, and Import, Share, Sync and Select are secondary. Series and Collections: "New series" / "New collection" primary. Gallery: "Upload" primary.
    - Toolbars (search, sort, overflow) stay in the body.
    - Body width: `style.contentMaxWidth`, as today. Gallery gets it from the context.
  - **Subtitle:** the count ("26 books", "4 series", "3 collections", "12 images").
  - **Empty states:** use `EmptyState` with the matching nav icon wherever a list can be empty.
  - **Remove** `PageContainer` from these files.

- [ ] **Step 4: Run the suite, then do the manual check**

Run: `cd frontend && npm test && npm run typecheck && npm run lint`
Expected: PASS.

Manual check: with `node scripts/dev-web.mjs --reset` running, snapshot `/dashboard/library`, `/dashboard/series`, `/dashboard/collections` and `/dashboard/gallery` at 1280 and 360. Each listing should show:
- one `h1 "Library"`;
- the four tab links, with the current one first in focus order;
- no `⚠ <44px` in the band;
- at 360, the page no wider than 360px.

Then run `npm run dev:release`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/LibraryPage.tsx frontend/src/pages/GroupsPage.tsx frontend/src/pages/GalleryPage.tsx frontend/scripts/test-page-frame.mts && git commit -m "Library, Series, Collections and Gallery share the Library band and tabs"
```

### Task 5: Games, Community and Admin areas on `Page`

**Files:**
- Modify: `frontend/src/pages/ArenaListPage.tsx`
- Modify: `frontend/src/pages/DiscoverPage.tsx`
- Modify: `frontend/src/pages/PeoplePage.tsx`
- Modify: `frontend/src/pages/AdminGenresPage.tsx`
- Modify: `frontend/src/pages/AdminSynopsesPage.tsx`
- Modify: `frontend/src/pages/AdminTranslationsPage.tsx`
- Test: `frontend/scripts/test-page-frame.mts`

**Interfaces:**
- Consumes: `Page` (Task 2) and `area("games" | "community" | "admin").tabs` (Task 1).

- [ ] **Step 1: Extend the source guard** in `frontend/scripts/test-page-frame.mts`, with the same shape as Task 4. Each file must use `<Page` with its area's tabs:
  - `ArenaListPage` → `games`
  - `DiscoverPage` and `PeoplePage` → `community`
  - The three admin pages → `admin`

  Also assert that `ArenaListPage` no longer contains `aria-pressed` tab buttons.

- [ ] **Step 2: Run it and see it fail**

Run: `cd frontend && npx tsx --tsconfig tsconfig.app.json --test scripts/test-page-frame.mts`
Expected: FAIL on ArenaListPage.

- [ ] **Step 3: Migrate.**
  - **ArenaListPage:** the segmented `?tab=` control is replaced by the band's tabs. `handleTabSwitch` goes and the `tab` read stays. "New tier list", "New quiz" and "New tournament" is the one primary for the active tab.
  - **DiscoverPage:** keep its type filter in the body. Signed-out `/arena` (`PublicDiscoverPage`, same file) is handled in Task 9.
  - **Admin pages:** the queues use `EmptyState` when empty. Non-admins keep getting `NotFoundPage`.

- [ ] **Step 4: Run the suite, then do the manual check**

Run: `cd frontend && npm test && npm run typecheck && npm run lint`
Expected: PASS.

Manual check: snapshot `/dashboard/arena`, `/dashboard/arena?tab=quizzes`, `/community/discover`, `/community/people` and `/admin/genres` at 1280 and 360. Each should show one `h1`, the right tab with `aria-current`, and the page fitting at 360. Then run `npm run dev:release`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ArenaListPage.tsx frontend/src/pages/DiscoverPage.tsx frontend/src/pages/PeoplePage.tsx frontend/src/pages/AdminGenresPage.tsx frontend/src/pages/AdminSynopsesPage.tsx frontend/src/pages/AdminTranslationsPage.tsx frontend/scripts/test-page-frame.mts && git commit -m "Games, Community and Admin use the band and its tabs"
```


### Task 6: Settings becomes Account · Appearance · Style

**Files:**
- Modify: `frontend/src/pages/SettingsPage.tsx`
- Create: `frontend/src/pages/SettingsAppearancePage.tsx`
- Modify: `frontend/src/pages/LibraryStylePage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/scripts/test-reader-card-editor.mts`
- Test: `frontend/scripts/test-page-frame.mts`

**Interfaces:**
- Consumes: `Page` (Task 2) and `area("settings").tabs` (Task 1).
- Produces: route `/dashboard/settings/appearance` → `SettingsAppearancePage`.

- [ ] **Step 1: Extend the source guard.**
  - All three page files use `<Page` with `area("settings").tabs`.
  - `App.tsx` declares `path="/dashboard/settings/appearance"`.
  - `SettingsPage` no longer has an "Appearance" or "Reader card" section heading.
  - In `test-reader-card-editor.mts`, the "way in from Settings" assertion (`:118`) becomes a way in from the area map: `area("readerCard").to === "/dashboard/reader-card"`.

- [ ] **Step 2: Run it and see it fail**

Run: `cd frontend && npx tsx --tsconfig tsconfig.app.json --test scripts/test-page-frame.mts`
Expected: FAIL.

- [ ] **Step 3: Split the page.**
  - Move today's Appearance section (`SettingsPage.tsx:71`, theme and fonts) into `SettingsAppearancePage`.
  - Remove the Reader card section (`SettingsPage.tsx:172`), since the sidebar now reaches it.
  - Account keeps the rest, each group in a card inside the body.
  - `LibraryStylePage` gets the Settings band (title "Settings", tab Style) and moves its own subtitle line into `subtitle`.
  - The two "Change" buttons keep the distinct names lane C gave them. Their 44px size is Task 12's job.

- [ ] **Step 4: Run the suite, then do the manual check**

Run: `cd frontend && npm test && npm run typecheck && npm run lint`
Expected: PASS.

Manual check:
1. Snapshot `/dashboard/settings`, `/dashboard/settings/appearance` and `/dashboard/style` at 1280 and 360. All three should show `h1 "Settings"` with the right tab current.
2. On Appearance, change the theme, reload, and confirm it persisted.
3. Run `npm run dev:release`.

- [ ] **Step 5: Commit, then ship Phase 1**

```bash
git add frontend/src/pages/SettingsPage.tsx frontend/src/pages/SettingsAppearancePage.tsx frontend/src/pages/LibraryStylePage.tsx frontend/src/App.tsx frontend/scripts/test-reader-card-editor.mts frontend/scripts/test-page-frame.mts && git commit -m "Split Settings into Account, Appearance and Style tabs"
```

Then use the ship skill to push and open PR 1 with auto-merge.

## Phase 2: single items, the remaining areas, and public pages (PR 2)

### Task 7: Games and Murals single items

**Files:**
- Modify: `frontend/src/pages/TierListCreatePage.tsx`
- Modify: `frontend/src/pages/TierListEditorPage.tsx`
- Modify: `frontend/src/pages/QuizCreatePage.tsx`
- Modify: `frontend/src/pages/QuizEditorPage.tsx`
- Modify: `frontend/src/pages/ArenaSeedPage.tsx`
- Modify: `frontend/src/pages/MuralEditorPage.tsx`
- Test: `frontend/scripts/test-page-frame.mts`

**Interfaces:**
- Consumes: `Page` with `title: ReactNode` (Task 2), and `backTo("tierlist" | "quiz" | "tournament" | "mural")` (Task 1).

- [ ] **Step 1: Extend the source guard.**
  - Each file uses `<Page` with a `back=` built from `backTo(…)`, and no `tabs=`.
  - No file contains a visible "Arena" (`assert.doesNotMatch(src, />[^<{]*\bArena\b[^<]*</)`), nor "All tournaments", "← Tier lists" or "← Quizzes".

- [ ] **Step 2: Run it and see it fail**

Run: `cd frontend && npx tsx --tsconfig tsconfig.app.json --test scripts/test-page-frame.mts`
Expected: FAIL.

- [ ] **Step 3: Migrate.**
  - **Title:** the item's name.
    - The mural, tier list editor and seed page pass their existing click-to-rename button or input as `title` (`MuralEditorPage.tsx:476-499`, `TierListEditorPage.tsx:197-217`, `ArenaSeedPage.tsx:216-236`).
    - Renaming keeps working.
  - **Subtitle:** one key fact, such as "Step n of m" in the wizards or the seed slot count.
  - **Band primary:** "Done editing" in mural edit mode and "Start tournament" on the seed page. Every other button is secondary.
  - **Quiz editor's "Publish quiz":** stays where it is (spec non-goal #8). It stays the view's one accent.
  - **Mural editor back link:** keeps today's `?folder=` (`MuralEditorPage.tsx:94`). It uses `{ ...backTo("mural"), to: folder ? `${backTo("mural").to}?folder=${folder}` : backTo("mural").to }`.
  - **Mural edit mode:** the band may compress to a single row and drop its subtitle. It must keep the title.
  - **Mural canvas:** keeps its saved width, centred in the body.
  - **Copy:** "Arena" → "Games" wherever it shows.

- [ ] **Step 4: Run the suite, then do the manual check**

Run: `cd frontend && npm test && npm run typecheck && npm run lint`
Expected: PASS.

Manual check:
1. Create a tier list, a quiz, a tournament (go as far as its seed page) and a mural, each with a 60-character name. Put the mural in a folder.
2. Snapshot each at 1280 and 360. Each should show:
   - one `h1`;
   - a back link "Games"/"Murals" whose `→ href` matches the rule above, with the folder kept for the mural;
   - exactly one accent button;
   - at 360, the title wrapping inside the band, and the page no wider than 360px.
3. Rename the mural from its title, and confirm the new name sticks after a reload.
4. Run `npm run dev:release`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/TierListCreatePage.tsx frontend/src/pages/TierListEditorPage.tsx frontend/src/pages/QuizCreatePage.tsx frontend/src/pages/QuizEditorPage.tsx frontend/src/pages/ArenaSeedPage.tsx frontend/src/pages/MuralEditorPage.tsx frontend/scripts/test-page-frame.mts && git commit -m "Games and Murals items get the band with a back link"
```

### Task 8: Home, Murals list, Reader card and profiles

**Files:**
- Modify: `frontend/src/pages/HomePage.tsx`
- Modify: `frontend/src/pages/MuralsListPage.tsx`
- Modify: `frontend/src/pages/ReaderCardPage.tsx`
- Modify: `frontend/src/pages/CommunityProfilePage.tsx`
- Modify: `frontend/src/components/OwnShelfView.tsx`
- Test: `frontend/scripts/test-page-frame.mts`

**Interfaces:**
- Consumes: `Page` and `BUTTON_*` (Task 2), and `backTo("profile")` (Task 1).

- [ ] **Step 1: Extend the source guard.**
  - The four pages and `OwnShelfView` use `<Page`.
  - `CommunityProfilePage` and `OwnShelfView` pass `back={backTo("profile")}`.
  - `OwnShelfView` has no `<h1` of its own.
  - `MuralsListPage` has no `uppercase` class on its filter labels.
  - `HomePage`'s local `const button` is gone.

- [ ] **Step 2: Run it and see it fail**

Run: `cd frontend && npx tsx --tsconfig tsconfig.app.json --test scripts/test-page-frame.mts`
Expected: FAIL.

- [ ] **Step 3: Migrate.**
  - **Home:** title "Home". Find people and Discover become secondary actions.
  - **Murals:** title "Murals". The preset banner moves below the band, "New mural" is the primary, and the filter labels are sentence case.
  - **Reader card:** title "Reader card".
  - **Profiles:** both another reader's profile and your own shelf (`OwnShelfView`, reached from the sidebar avatar) get the band.
    - Title: the display name or `@username`.
    - Type tags and section labels are sentence case.
    - Mural block headings stay as they are.

- [ ] **Step 4: Run the suite, then do the manual check**

Run: `cd frontend && npm test && npm run typecheck && npm run lint`
Expected: PASS.

Manual check:
1. Snapshot `/dashboard`, `/dashboard/murals`, `/dashboard/reader-card`, `/community/u/fixture_alice` and your own `/community/u/<fixture username>` at 1280 and 360. Each should show one `h1` and fit at 360.
2. Run `npm run dev:release`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/HomePage.tsx frontend/src/pages/MuralsListPage.tsx frontend/src/pages/ReaderCardPage.tsx frontend/src/pages/CommunityProfilePage.tsx frontend/src/components/OwnShelfView.tsx frontend/scripts/test-page-frame.mts && git commit -m "Home, Murals, Reader card and profiles use the band"
```

### Task 9: Public frame, and the pages that serve both

**Files:**
- Create: `frontend/src/layouts/PublicLayout.tsx`
- Create: `frontend/src/layouts/SessionLayout.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/book/BookScreen.tsx`
- Delete: `frontend/src/components/work/BackLink.tsx`
- Modify: `frontend/src/pages/WorkPage.tsx`
- Modify: `frontend/src/pages/WorkStatsPage.tsx`
- Modify: `frontend/src/pages/BookKeyPage.tsx`
- Modify: `frontend/src/pages/ArenaViewPage.tsx`
- Modify: `frontend/src/pages/SharedLibraryPage.tsx`
- Modify: `frontend/src/pages/SharedMuralPage.tsx`
- Modify: `frontend/src/pages/VoteTierlistPage.tsx`
- Modify: `frontend/src/pages/PlayQuizPage.tsx`
- Modify: `frontend/src/pages/DiscoverPage.tsx`
- Modify: `frontend/scripts/test-work-page.mts`
- Test: `frontend/scripts/test-public-layout.mts`

**Interfaces:**
- Consumes: `Page`, `PageWidthContext` (Task 2), and `backTo("book" | "tournament")` (Task 1).
- Produces:
  - `PublicLayout({ signedIn }: { signedIn: boolean }): JSX.Element`. A top row with `BrandLockup` linking to `/`, then on the right either "Log in" (`/login`) or, when signed in, "Open my library" (`/dashboard`). Then `<Outlet>` inside `PageWidthContext` at the default width. No sidebar.
  - `SessionLayout(): JSX.Element` returns `session ? <DashboardLayout/> : <PublicLayout signedIn={false}/>`, using `useAuth()`.
  - The routes that always use `PublicLayout` get `signedIn={Boolean(session)}` through a one-line wrapper in `App.tsx`.
  - `PublicLayout` takes a prop, not the auth context, because `AuthProvider` can't render under `renderToString` (no `getServerSnapshot`).

- [ ] **Step 1: Write the failing tests** in `frontend/scripts/test-public-layout.mts`.

```ts
const render = (signedIn: boolean) => renderToString(createElement(MemoryRouter, null, createElement(PublicLayout, { signedIn })));

test("signed out: brand, a Log in link, no sidebar", () => {
  const html = render(false);
  assert.match(html, /<a(?=[^>]*href="\/login")[^>]*>Log in<\/a>/);
  assert.match(html, /href="\/"/);
  assert.doesNotMatch(html, /<aside/);
});

test("signed in: the right link opens the library", () => {
  assert.match(render(true), /<a(?=[^>]*href="\/dashboard")[^>]*>Open my library<\/a>/);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd frontend && npx tsx --tsconfig tsconfig.app.json --test scripts/test-public-layout.mts`
Expected: FAIL, the module is not found.

- [ ] **Step 3: Implement the layouts and rewire `App.tsx`.**
  - **Routes:**
    - `/work/:id`, `/work/:id/stats` and `/arena/:id` go under `SessionLayout`.
    - `/book/:key` moves inside the `DashboardLayout` route. It is behind `RequireAuth` and `RequireUsername` today and stays signed-in only.
    - `/shared/murals/:token`, `/shared/library/:token`, `/vote/:code`, `/play/:code` and `/arena` go under `PublicLayout`.
    - The signed-in `/arena` redirect (`discoverDestination`) stays.
  - **Work and book pages:** `BookScreen` gives up the parts the band now owns:
    - its `<main>` wrapper (`BookScreen.tsx:163`);
    - the back link (`:165`);
    - Share and More (`:166-175`), which become band `actions`;
    - the hero `h1` (`:200`). The title moves to the band; the hero keeps cover, series, author and awards.

    `WorkPage` and `BookKeyPage` render `Page` with `title`, `back` and those actions. Delete `BackLink.tsx`, and in `test-work-page.mts` replace the `BackLink` test (`:163`) with one asserting that `BookScreen`'s output contains no `<h1`.
  - **Signed-out back links:** a signed-out Work or stats page shows no back link, because there is no library to go back to. `ArenaViewPage` uses `backTo("tournament")` when signed in and `{ to: "/arena", label: "Games" }` when signed out. Its owner actions appear in the band for the owner only.
  - **`PublicDiscoverPage`** (in `DiscoverPage.tsx`): drop its own `min-h-screen` wrapper, `h1` and "Sign in" link (`DiscoverPage.tsx:72-82`), because `PublicLayout` supplies the Log in link. Render `Page` with title "Games".
  - **`SharedLibraryPage`:** passes the owner's `contentMaxWidth` as `maxWidth`.
  - **`SharedMuralPage`:** keeps its fullscreen button as an action.

- [ ] **Step 4: Run the suite, then do the manual check**

Run: `cd frontend && npm test && npm run typecheck && npm run lint`
Expected: PASS.

Manual check:
1. Signed in, snapshot `/work/<id>`, `/arena/<id>` and `/book/<key>`. Each should show the sidebar with Library or Games highlighted and one `h1`.
2. Signed out (`--signed-out`), snapshot `/work/<id>`, `/arena/<id>`, a shared library, a shared mural, `/vote/<code>`, `/play/<code>` and `/arena`, at 1280 and 360. Each should show one "Log in" link, no sidebar, one `h1`, no back link into `/dashboard`, and fit at 360. Take the share links, codes and ids from the site's own pages.
3. Run `npm run dev:release`.

- [ ] **Step 5: Commit, then ship Phase 2**

```bash
git add frontend/src/layouts/PublicLayout.tsx frontend/src/layouts/SessionLayout.tsx frontend/src/App.tsx frontend/src/components/book/BookScreen.tsx frontend/src/components/work/BackLink.tsx frontend/src/pages/WorkPage.tsx frontend/src/pages/WorkStatsPage.tsx frontend/src/pages/BookKeyPage.tsx frontend/src/pages/ArenaViewPage.tsx frontend/src/pages/SharedLibraryPage.tsx frontend/src/pages/SharedMuralPage.tsx frontend/src/pages/VoteTierlistPage.tsx frontend/src/pages/PlayQuizPage.tsx frontend/src/pages/DiscoverPage.tsx frontend/scripts/test-work-page.mts frontend/scripts/test-public-layout.mts && git commit -m "Public pages get the band without the sidebar; work and tournament pages follow the session"
```

Then use the ship skill to push and open PR 2 with auto-merge, based on `main` once PR 1 has merged.

## Phase 3: dialogs, controls, docs (PR 3)

### Task 10: One dialog shape — Sheet, Confirm and the library dialogs

**Files:**
- Modify: `frontend/src/components/Sheet.tsx`
- Modify: `frontend/src/components/ConfirmDialog.tsx`
- Modify: `frontend/src/components/ShareModal.tsx`
- Modify: `frontend/src/components/CoverPickerModal.tsx`
- Modify: `frontend/src/components/AddBookModal.tsx`
- Modify: `frontend/src/components/SyncGoodreadsModal.tsx`
- Modify: `frontend/src/components/PerCardStylePanel.tsx`
- Modify: `frontend/src/components/SocialsSection.tsx`
- Modify: `frontend/src/pages/GroupsPage.tsx`
- Test: `frontend/scripts/test-sheet.mts`

**Interfaces:**
- Produces:
  - `Sheet` gains `footer?: ReactNode`, rendered in a bottom row aligned to the end with an 8px gap.
  - Its title becomes `text-lg font-bold`.
  - Its other props are unchanged.
  - `ConfirmDialog` renders through `Sheet`, with its buttons in the footer.

- [ ] **Step 1: Write the failing tests** in `frontend/scripts/test-sheet.mts`. Stub `matchMedia` the way `scripts/test-work-page.mts` does, if `Sheet`'s effects need it.

```ts
const DIALOG_FILES = ["components/ShareModal", "components/CoverPickerModal", "components/AddBookModal", "components/SyncGoodreadsModal", "components/PerCardStylePanel", "components/SocialsSection", "pages/GroupsPage", "components/ConfirmDialog"];

test("title left at text-lg, 44px Close on the right, optional footer", () => {
  const html = renderToString(createElement(Sheet, { title: "Change username", onClose: () => undefined, footer: createElement("button", null, "Save"), children: "body" }));
  assert.match(html, /<h2 class="[^"]*text-lg font-bold/);
  assert.match(html, /<button(?=[^>]*aria-label="Close")(?=[^>]*h-11 w-11)[^>]*>/);
  assert.match(html, />Save<\/button>/);
});

test("these dialogs are built on Sheet, with no hand-rolled overlay or Close text button", () => {
  for (const file of DIALOG_FILES) {
    const src = readFileSync(new URL(`../src/${file}.tsx`, import.meta.url), "utf8");
    assert.match(src, /<Sheet\b/, file);
    assert.doesNotMatch(src, /fixed inset-0/, file);
    assert.doesNotMatch(src, />\s*Close\s*</, file);
  }
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd frontend && npx tsx --tsconfig tsconfig.app.json --test scripts/test-sheet.mts`
Expected: FAIL.

- [ ] **Step 3: Add `footer` to `Sheet`, then move each listed dialog onto it.**
  - Fields follow the DESIGN.md Input pattern: a `body-strong` label linked by `htmlFor`/`id`, a hint or error line under it, and a `danger` border on error.
  - A disabled submit names what's missing in the hint line.
  - The "New collection" name field (in `GroupsPage`) shows an error on an empty name instead of closing silently.

- [ ] **Step 4: Run the suite, then do the manual check**

Run: `cd frontend && npm test && npm run typecheck && npm run lint`
Expected: PASS.

Manual check:
1. Open each dialog with `web-snapshot` steps at 1280 and 360: Add book, Share, Sync Goodreads, cover picker, card style, socials, New collection, and a delete confirm. Each listing should show one `button "Close"` at 44×44, labelled fields, and at most one accent button.
2. Run `npm run dev:release`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Sheet.tsx frontend/src/components/ConfirmDialog.tsx frontend/src/components/ShareModal.tsx frontend/src/components/CoverPickerModal.tsx frontend/src/components/AddBookModal.tsx frontend/src/components/SyncGoodreadsModal.tsx frontend/src/components/PerCardStylePanel.tsx frontend/src/components/SocialsSection.tsx frontend/src/pages/GroupsPage.tsx frontend/scripts/test-sheet.mts && git commit -m "Sheet gets a footer; Confirm and the library dialogs use it"
```

### Task 11: One dialog shape — murals, games and shelf dialogs

**Files:**
- Modify: `frontend/src/components/murals/MoveToFolderModal.tsx`
- Modify: `frontend/src/components/murals/BlockConfigPanel.tsx`
- Modify: `frontend/src/components/murals/BlockStylePanel.tsx`
- Modify: `frontend/src/components/tierlist/AddBooksSheet.tsx`
- Modify: `frontend/src/components/arena/SeedSlotGrid.tsx`
- Modify: `frontend/src/components/OwnShelfView.tsx`
- Test: `frontend/scripts/test-sheet.mts`

**Interfaces:**
- Consumes: `Sheet` with `footer` (Task 10).

- [ ] **Step 1: Extend `DIALOG_FILES`** in `test-sheet.mts` with the six files. Also assert that `BlockConfigPanel.tsx` has no visible "Arena" (`/>[^<{]*\bArena\b[^<]*</`, today at `:394,416,422`).

- [ ] **Step 2: Run it and see it fail**

Run: `cd frontend && npx tsx --tsconfig tsconfig.app.json --test scripts/test-sheet.mts`
Expected: FAIL.

- [ ] **Step 3: Move each onto `Sheet`, with the same field rules as Task 10.**
  - The mural block dialog loses its duplicate Close/Cancel.
  - Its Heading and Text fields keep the `htmlFor` links lane C added.
  - "Arena" → "Games" in `BlockConfigPanel`.
  - `ReaderCardViewer` is a full-screen viewer, not a titled dialog, and stays as it is. Ruling: no title and no commit action, so the dialog rule doesn't apply.

- [ ] **Step 4: Run the suite, then do the manual check**

Run: `cd frontend && npm test && npm run typecheck && npm run lint`
Expected: PASS.

Manual check:
1. Open each dialog at 1280 and 360: move to folder, block config, block style, add books to a tier list, a seed slot picker, and the own-shelf profile sheet. Expect the same pass marks as Task 10.
2. Run `npm run dev:release`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/murals/MoveToFolderModal.tsx frontend/src/components/murals/BlockConfigPanel.tsx frontend/src/components/murals/BlockStylePanel.tsx frontend/src/components/tierlist/AddBooksSheet.tsx frontend/src/components/arena/SeedSlotGrid.tsx frontend/src/components/OwnShelfView.tsx frontend/scripts/test-sheet.mts && git commit -m "Mural, game and shelf dialogs use Sheet"
```

### Task 12: Controls and fields sweep — 44px, one accent, icons, labels

**Files:**
- Modify: `frontend/src/components/Toolbar.tsx`
- Modify: `frontend/src/components/OptionsMenu.tsx`
- Modify: `frontend/src/components/LibraryToolbar.tsx`
- Modify: `frontend/src/pages/GroupsPage.tsx`
- Modify: `frontend/src/pages/SettingsPage.tsx`
- Modify: `frontend/src/components/BookCard.tsx`
- Modify: `frontend/src/pages/HomePage.tsx`
- Modify: `frontend/src/pages/MuralEditorPage.tsx`
- Modify: `frontend/src/pages/ArenaSeedPage.tsx`
- Modify: `frontend/src/layouts/DashboardLayout.tsx`
- Modify: `frontend/src/components/NavIcons.tsx`
- Modify: `frontend/src/pages/ArenaListPage.tsx`
- Modify: `frontend/src/pages/MuralsListPage.tsx`
- Modify: `frontend/src/components/murals/MuralFolderTree.tsx`
- Modify: `frontend/src/pages/QuizCreatePage.tsx`
- Modify: `frontend/src/pages/TierListCreatePage.tsx`
- Modify: `frontend/src/pages/LibraryStylePage.tsx`
- Modify: `frontend/src/components/StyleControls.tsx`
- Modify: `frontend/src/components/readerCard/ReaderCardChoices.tsx`
- Modify: `frontend/src/components/readerCard/ReaderCardOptions.tsx`
- Modify: `frontend/src/components/readerCard/ReaderGlyphSetting.tsx`
- Modify: `frontend/src/auth/AccountSecuritySection.tsx`
- Modify: `frontend/src/components/SocialsSection.tsx`
- Modify: `frontend/src/pages/DiscoverPage.tsx`
- Modify: `frontend/src/pages/PeoplePage.tsx`
- Modify: `frontend/src/pages/CommunityProfilePage.tsx`
- Modify: `frontend/src/components/OwnShelfView.tsx`
- Modify: `frontend/src/components/ProfileActivity.tsx`
- Modify: `frontend/src/components/ToggleSwitch.tsx`
- Modify: `frontend/src/components/readerCard/DraftField.tsx`
- Modify: `frontend/src/components/murals/MuralCanvas.tsx`
- Modify: `frontend/src/components/murals/blocks/BookBlocks.tsx`
- Modify: `frontend/src/components/PerCardStylePanel.tsx`
- Modify: `frontend/src/pages/QuizEditorPage.tsx`
- Modify: `frontend/src/components/murals/BlockConfigPanel.tsx`
- Modify: `frontend/src/index.css`
- Test: `frontend/scripts/test-controls.mts`

Ruling (controller, during execution): the first sweep pass flagged controls under 44px in the files from `DashboardLayout.tsx` down, which the original list missed. They join the task. `SettingsAppearancePage`'s 1×1 radios are visually hidden inputs inside 44px label tiles, so they are false positives and stay out.

**Interfaces:**
- Consumes: `BUTTON_PRIMARY` and `BUTTON_SECONDARY` (Task 2), and `SettingsIcon` from `components/NavIcons.tsx`.

- [ ] **Step 1: Write the failing tests** in `frontend/scripts/test-controls.mts`.

```ts
const src = (f: string) => readFileSync(new URL(`../src/${f}.tsx`, import.meta.url), "utf8");

test("menus open on three dots, not the sun glyph", () => {
  assert.match(src("components/OptionsMenu"), /MoreIcon/);
  assert.doesNotMatch(src("components/OptionsMenu"), /<circle cx="12" cy="12" r="3"/);
});

test("settings actions use the sidebar's gear, and the bare-ring GearIcon is gone", () => {
  assert.doesNotMatch(src("components/Toolbar"), /export function GearIcon/);
  for (const f of ["pages/GroupsPage", "components/LibraryToolbar"]) assert.doesNotMatch(src(f), /GearIcon/, f);
});

test("Settings' Change buttons and fields meet the 44px floor and carry labels", () => {
  const s = src("pages/SettingsPage");
  assert.doesNotMatch(s, /text-xs[^"]*"[^>]*>\s*Change/);
  assert.match(s, /<label[^>]*htmlFor=/);
});
```

Before relying on the sun-glyph assertion, check `OptionsMenu.tsx:24-31` for the actual `circle` it draws, and adjust the regex to match it.

- [ ] **Step 2: Run them and see them fail**

Run: `cd frontend && npx tsx --tsconfig tsconfig.app.json --test scripts/test-controls.mts`
Expected: FAIL.

- [ ] **Step 3: Fix the named controls, then sweep with the listing.**
  - **Named fixes:**
    - `OptionsMenu`'s default trigger uses `MoreIcon`.
    - Remove `Toolbar`'s `GearIcon`. `GroupsPage:359` and `LibraryToolbar:98` use `SettingsIcon`.
    - Settings "Change" buttons and fields get 44px targets and labelled inputs (`SettingsPage.tsx:95-101,127-142`).
    - Card Style/Cover chips (`BookCard`) and Home activity rows (`HomePage`) get 44px hit areas.
    - The mural editor and seed page toolbars reach 44px, with one accent each.
  - **Sweep:**
    1. Run `node scripts/dev-web.mjs --reset`.
    2. Snapshot every signed-in route in `App.tsx` at 1280 and 360.
    3. Check every `⚠ <44px` row, every `(no label)` field, and any view with two accent buttons.
    4. Fix the ones in this task's files.
    5. If one remains in a file this task doesn't list, stop and report it as NEEDS_CONTEXT with the file and the listing row. The controller adds it to the plan, because the scope gate rejects unlisted files.

- [ ] **Step 4: Run the suite and re-run the sweep**

Run: `cd frontend && npm test && npm run typecheck && npm run lint`
Expected: PASS. A second snapshot pass over every signed-in route shows no `⚠ <44px` row and no `(no label)` field. Then run `npm run dev:release`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Toolbar.tsx frontend/src/components/OptionsMenu.tsx frontend/src/components/LibraryToolbar.tsx frontend/src/pages/GroupsPage.tsx frontend/src/pages/SettingsPage.tsx frontend/src/components/BookCard.tsx frontend/src/pages/HomePage.tsx frontend/src/pages/MuralEditorPage.tsx frontend/src/pages/ArenaSeedPage.tsx frontend/scripts/test-controls.mts && git commit -m "Raise every control to 44px, one accent per view, three-dot menus and labelled fields"
```

### Task 13: Document the frame, retire `PageContainer`

**Files:**
- Delete: `frontend/src/components/PageContainer.tsx`
- Modify: `frontend/src/components/LibraryCanvas.tsx`
- Modify: `frontend/src/components/Toolbar.tsx`
- Modify: `frontend/src/pages/LibraryStylePage.tsx`
- Modify: `DESIGN.md`
- Modify: `frontend/README.md`
- Modify: `frontend/scripts/test-page-frame.mts`
- Modify: `frontend/scripts/test-library-style.mts`
- Modify: `packages/shared/src/library/libraryStyle.ts`

- [ ] **Step 1: Confirm nothing imports `PageContainer`**

Run: `rg -n "import.*PageContainer" frontend/src frontend/scripts`
Expected: no matches. Move any page still on it to `Page` first.

- [ ] **Step 2: Update the comments and docs that name it.**
  - Point the existing comments that mention `PageContainer` at `Page` (`LibraryCanvas.tsx:9,21,23`, `Toolbar.tsx:21`, `LibraryStylePage.tsx:201`).
  - **`DESIGN.md`:**
    - Add a "Page frame" section to Layout covering areas, the band, tabs, back links, the public band and widths.
    - Add `Page` and `SidebarNav` to Components.
    - Note `Sheet`'s footer.
    - Replace "web composes the same tokens ad hoc per call site, no shared primitives" with the primitives that now exist.
  - **`frontend/README.md`:** describe the layout split (`DashboardLayout` / `PublicLayout` / `SessionLayout`).
  - Tell the user that the live Design System artifact needs the same update, since `DESIGN.md` mirrors it.

- [ ] **Step 3: Run the checks**

Run: `rg -n "PageContainer" frontend/src && cd frontend && npm test && npm run typecheck && npm run lint`
Expected: `rg` prints nothing, and the suite passes.

- [ ] **Step 4: Commit, then ship Phase 3**

```bash
git add frontend/src/components/PageContainer.tsx frontend/src/components/LibraryCanvas.tsx frontend/src/components/Toolbar.tsx frontend/src/pages/LibraryStylePage.tsx DESIGN.md frontend/README.md && git commit -m "Document the page frame and retire PageContainer"
```

Use the ship skill to push and open PR 3 with auto-merge.

Then ask the user to run a full `site-ui-reviewer` pass. The spec requires it, and only the user dispatches that agent. The pass succeeds when it shows:
- no harmony finding on H1–H8;
- no `⚠ <44px` row on a signed-in page.
