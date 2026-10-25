# Site page frame — design

## Why

The first site UI review (2026-10-25, main checkout `ui-reviews/2026-10-25-1212/report.md`) found that the website reads like several products. Every page builds its own header, width, buttons and dialogs. The user agreed and, shown five mockups (`.superpowers/brainstorm/…/page-shell-alternatives.html`), picked **option D: a header band with tabs**. This spec turns that choice and the review's harmony findings (H1–H8, plus #9, #11 and #16) into one frame and one set of rules for every web page.

The site does not need to look like the mobile app. Coherence *within* the site is the goal.

## Goals

- Every signed-in page sits in the same frame: a sidebar that picks an **area**, and a **header band** at the top of the page that names it, holds its actions, and, where the area has sibling pages, holds **tabs** to them.
- Public pages (share links, vote, play, public tournaments, signed-out Work/book pages) use the same band without the sidebar.
- One rule each for buttons, touch targets, dialogs, empty states, form fields, label case and page width, applied to every page.
- Moving from any page to any other never changes the title's place, style or level.

## Non-goals

- New features, or features ported from the app.
- Visual parity with the mobile app.
- The landing page, privacy page and sign-in journey. They have their own public layout, and the user keeps the landing page as it is.
- Flow changes the review listed separately: where a new public tier list lands (#6), drafts created on click (#10), the quiz editor's Publish position (#8), and merging Discover with public tournaments (#18's second half).
- Theme work. Every theme must still pass, but no token changes.

## Anti-goals

- A frame that only some pages adopt. A page left on its old header is a defect this work must close, not a follow-up.
- Three levels of navigation. Sidebar areas, then band tabs, then nothing. A single item never gets tabs in its band.
- Changed URLs. Every existing route keeps working, and bookmarks and share links stay valid.
- A redesign of page content: grids, cards, the mural canvas, the duel layout. The frame wraps content and does not restyle it, except where a rule below says so.

## The frame (decided with the user)

### Areas: the sidebar

The sidebar lists areas only, in this order: **Home, Library, Murals, Games, Reader card, Community, Settings**. Admin is an area for admins only, shown where `AdminLinks` appears today. The lockup, avatar, admin links and Log out stay where they are.

| Area | Tabs in its band | Routes behind the tabs |
|---|---|---|
| Home | none | `/dashboard` |
| Library | Books · Series · Collections · Gallery | `/dashboard/library`, `/dashboard/series`, `/dashboard/collections`, `/dashboard/gallery` |
| Murals | none | `/dashboard/murals` |
| Games | Tier lists · Quizzes · Tournaments | `/dashboard/arena?tab=…` (today's query tabs) |
| Reader card | none | `/dashboard/reader-card` (its own area, the user's call) |
| Community | Discover · People | `/community/discover`, `/community/people` |
| Settings | Account · Appearance · Style | `/dashboard/settings` (Account, the default), a new Appearance address, `/dashboard/style` |
| Admin | Genres · Synopses · Translations | `/admin/genres`, `/admin/synopses`, `/admin/translations` |

The user chose these groupings: Style goes under Settings, and Reader card gets its own area. Admin as an area with tabs is my call, applying the same rule.

### The header band

Every page opens with a band on `surface`, divided from the content by a `border` hairline, holding:

1. On a **single item** (a mural, a tournament or its seed page, a tier list or quiz editor or create wizard, a Work or book page, a community profile), a back link above the title, named after its area: "‹ Games", "‹ Murals", "‹ Library", "‹ Community". The name is always the sidebar's, so "Games", never "Arena".
2. The **title**: the page's only `h1`, in the theme's display font at the `heading` size (24/30, web `text-2xl`; 30px at `sm` and up is fine). On a tab of an area, the title is the area's name ("Library"), and the tab says which page you are on.
3. An optional **subtitle** in `text-dim`, `body` size, for one fact such as "26 books" or "Round 1 of 3".
4. **Actions** on the right: secondary buttons, then at most one accent button.
5. **Tabs** along the band's bottom edge, only on areas that have them. The active tab is `text` with a 2px `accent` underline, the others `text-dim`. Tabs are links to the routes above, marked so assistive tech knows which is current.

Below the band, content sits in one centred container whose width is the user's `contentMaxWidth` preference (default 1152px) on every page. Forms such as Settings sit in a card inside that container.

**At phone width** (below `sm`), the band keeps the title, which no page may hide any more. The actions wrap under the title, and the tabs become one horizontally scrolling row under it. The existing bottom tab bar and More drawer stay as the phone's area navigation, and they list the same areas as the sidebar.

**Which pages get it:** every page in this spec gets the full band. That includes the editors and canvases: the mural editor, the tier list and quiz editors and wizards, the seed page, the tournament, vote and play pages, Reader card and shared murals. The band sits above their content, and the content itself is unchanged. The only allowed variation is mural edit mode (see "Left to the builder"). *My call*, following the anti-goal that no page keeps its old header.

**Back links** go to the tab the item belongs to. A tier list goes to Games › Tier lists (`?tab=tierlists`), a quiz to Quizzes, and a tournament or seed page to Tournaments. A mural goes to Murals, and a Work or book page to Library › Books. A community profile goes to Community › Discover. *My call.*

**Width exception:** the container applies on every page. Content whose width is part of what the user made (the mural canvas at its saved width, a shared mural) keeps that width, centred in the container. Public pages use the default 1152px, except the shared library, which keeps the owner's preference as it does today. *My call.*

### Public pages: band without sidebar

`/shared/library/:token`, `/shared/murals/:token`, `/vote/:code`, `/play/:code`, `/arena` and `/arena/:id` when signed out, and `/work/:id`, `/work/:id/stats` and `/book/:key` when signed out, all get the same band with no sidebar. Above the band they get the brand lockup linking to `/` and a "Log in" link on the right. A signed-in viewer of `/work/:id`, `/work/:id/stats`, `/book/:key` and `/arena/:id` gets the full frame with the sidebar, so the sidebar no longer disappears on those pages (H2). A signed-in visitor to `/arena` keeps today's redirect to `/community/discover` (`discoverDestination`, `frontend/src/pages/DiscoverPage.tsx:76`). The user decided "band without sidebar for public pages". The lockup and Log in link are my call. They cost the landing-page decision nothing, because that page stays as it is.

## Rules under the frame (from the review and DESIGN.md)

- **Buttons** (H5, #9): one accent button per view, and every other button is the one secondary style (`surface` + `border`). The mural editor keeps "Done editing" as its accent, and the seed page keeps "Start tournament".
- **Touch targets** (#16): every tappable control is at least 44×44 CSS px. That includes sidebar links, settings gear icons, card chips, toolbar buttons and the Settings "Change" buttons. A smaller visible glyph is fine inside a 44px hit area. Two checks prove it. A style test asserts the frame's own controls (sidebar links, tabs, band actions, the dialog close button). For everything else, the final `site-ui-reviewer` pass must show no `⚠ <44px` row on a signed-in page. *My call.*
- **Dialogs** (H3, #11): one shape. `radius-lg`, title (`title` size) on the left, a 44px "×" icon button labelled "Close" on the right, labelled fields, and a footer with Cancel plus one primary button when the dialog commits something. No dialog has both a "Close" text button and Cancel. Sheets at phone width follow the same header, and only their header changes. Today there are three families:
  - `components/Sheet.tsx`: 18 importers.
  - `components/ConfirmDialog.tsx`: 9 importers.
  - Hand-rolled overlays in `ShareModal`, `CoverPickerModal`, `AddBookModal`, `SyncGoodreadsModal`, `MoveToFolderModal`, `ReaderCardViewer`, `AddBooksSheet`, `OwnShelfView`, `GroupsPage` and the mural block dialog (`components/murals/BlockConfigPanel.tsx`).

  The hand-rolled ones move onto the shared shape. This list came from a quick search, so the plan should confirm it.
- **Empty states** (H6): `EmptyState` everywhere something can be empty: icon, title, hint, optional primary action. That covers collections, series, gallery, games lists and the three admin queues.
- **Form fields** (H7): the DESIGN.md Input pattern, with a `body-strong` label above, a hint or error line below, and the border turning `danger` on error. A disabled submit names what's missing in the hint line.
- **Labels** (H8): sentence case everywhere ("Search", "Sort", "Published"). Mural block headings are DESIGN.md's one stated exception and stay as they are.
- **Icons**: the overflow menu is the three-dot glyph everywhere. A settings action uses the sidebar's gear (#21).
- **Naming**: the area is "Games" in every visible string. Routes keep `/arena`.

## Constraints

- Routes, query parameters (`?tab=`, `?action=`) and share-link formats stay as they are. The one new address is Settings › Appearance.
- `DESIGN.md` is the source for tokens. Every one of the eleven themes, theme decor and reduced motion must still work. The band uses tokens only.
- Repo rules (`AGENTS.md`, `frontend/AGENTS.md`): reuse before adding, no speculative options, no comments. Style tests assert real resolved layout.
- When the work lands, update `DESIGN.md` (and the live artifact it mirrors, through the user) with the frame and the components it adds, so the next page follows it.
- Verification includes a full `site-ui-reviewer` pass after the last piece lands. Only the user dispatches that agent, so the plan ends by asking for it.

## Left to the builder

- Component names and structure, for example one `PageFrame` with `PageHeader`/`PageTabs` or another split, and whether `PageContainer` grows into it.
- Whether tabs use `role="tablist"` or a `nav` with `aria-current`, as long as the current tab is announced.
- The Appearance tab's address (`/dashboard/settings/appearance` or `?tab=appearance`). The split itself is *my call*: Appearance takes today's "Appearance" section (theme and fonts, `pages/SettingsPage.tsx:71`), and Account keeps the rest. The "Reader card" section (`SettingsPage.tsx:172`) goes, since Reader card is now its own area. Style stays at `/dashboard/style` as the third tab.
- Mural edit mode, which hides the phone bottom bar today: whether the band compresses too.
- Order of migration and how to split it into PRs. Each PR leaves the site coherent for the pages it touches.
- Whether `/arena/:id` shows owner actions in the band for the owner only. Today it serves both owner and visitor.
- How the bottom tab bar picks its first items from the new area list. The More drawer holds the rest, Admin included.
- Whether a page on a public-or-signed-in route renders a loading state or the public band while auth resolves.

## Today's shell, for orientation

- `frontend/src/layouts/DashboardLayout.tsx` is the only shell. `NAV_GROUPS` (`:40-65`) lists Home, Library, Series and Collections, then Gallery, Murals and Games, then Settings. Below `lg`, the shell is a bottom tab bar plus a More drawer.
- No shared page header exists. Pages mostly use `h2 text-lg font-bold`, several hide it below `sm`, and Home and the editors use `h1`.
- `components/PageContainer.tsx` is the only shared width wrapper. Only Library, Series, Collections and the shared library pass `contentMaxWidth`. Other pages use `max-w-xl`…`max-w-5xl`.
- Games' tabs are a `?tab=` segmented control (`pages/ArenaListPage.tsx:43, 105-119`). `components/SwipeTabs.tsx` is the one real `tablist`.
- There are no style tests of the shell or headers. `frontend/scripts/test-library-style.mts` covers `contentMaxWidth`.
