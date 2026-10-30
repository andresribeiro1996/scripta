# Desktop revamp — design

## Why

The user, 2026-10-29: "the site on browser desktop UI / UX is a complete mess, can we do a full revamp of it?" They asked for a **total makeover**, with the 2026-10-25 site UI review (main checkout `ui-reviews/2026-10-25-1212/report.md`) as a starting point only. They skipped the design questions ("just start"), so every decision below is *my call* unless it says otherwise.

The 2026-10-25 page-frame work (`docs/superpowers/specs/2026-10-25-site-page-frame-design.md`) made every page share one frame: the sidebar plus a white header band. It made pages consistent, but it didn't make the desktop site good. Here's what a 1440×900 pass with the fixture account (2026-10-29) found:

- **Navigation scrolls away.** The 224px sidebar is `static` and as tall as the page (`frontend/src/layouts/DashboardLayout.tsx:47`). On Home, which is 3,296px tall, the nav is gone after one screen, and the account footer only shows at the very bottom of the document. Above that footer the sidebar is mostly empty.
- **Headers are split in two.** The white band holds only the title (`frontend/src/components/page/Page.tsx:25-35`). Actions, subtitle and tabs sit loose in the body below it (`:37-57`), so "Add a book", "New mural", "Following" and Share float on the right, cut off from the title they belong to. Content starts about 180px down the page.
- **The width is wasted.** Covers render 218×326, so Home is one 3.7-screen column: 6 reading books wrap onto two rows, then 7 more, then a quote, then 20 activity rows as 20 separate full-width cards. Settings is a 536px column stuck to the left. A profile is an ~850px centred column, and a started tournament is ~290px.
- **Too many boxes.** Activity, people, series and settings each wrap every item in its own white card.
- **The review's harmony findings** (H1–H8) were half closed by the page-frame work. The parts it left open (hand-rolled buttons, inputs and danger fills; three empty-state shapes) are still there (`frontend/src/components/ConfirmDialog.tsx:79`, `frontend/src/components/AddBookModal.tsx:312-372`, `frontend/src/pages/PeoplePage.tsx:17`).

Mockups: the "Atmyshelf desktop revamp" design canvas, https://claude.ai/artifact/8i4a5Kt22ny6DeyHaqwcow. A copy of each artboard's source is in `docs/superpowers/specs/2026-10-29-desktop-revamp-mockups/` (`home.dc.html` is the social Home agreed on 2026-10-30). The inline styles there are the measurements this document refers to.

## Goals

- **Navigation is always one click away on desktop.** A sticky top bar holds the areas and the account menu.
- **One page header, used by every page.** It holds an optional back link, the title, an optional one-fact subtitle, the page's actions on the title's own row, and optional tabs underneath. It sits on the page background, with no separate band.
- **Pages use the width.** Content is centred in one of three widths (wide, default, narrow), and desktop gets real compositions: two columns on Home, a cover-and-text hero on the book page, a side navigation in Settings, and preview plus controls in Reader card.
- **Calmer, denser content.** Fewer boxes: a list is one container with rows, not a card per item. Covers outside the owner's library grid look like books, in one consistent style.
- **One of each control**: primary, secondary and danger buttons, icon buttons, text fields, filter chips, menus, dialogs and empty states. No hand-rolled copies on the pages this work touches, and by the end that covers every page.
- **Nothing regresses**: all eleven themes, their decor, reduced motion, the AA pairs, the 44px floor and phone-width web all keep working.

What success looks like (*my call*):
- At 1440×900, Home's first screen shows games from people you follow and the For you panel.
- Every page's content is centred. No column hugs the left edge.
- Desktop navigation is visible at every scroll position.
- Going from any page to any other never moves or restyles the title.
- No page shows a header band or floating action row from the old frame.

## Non-goals

- The landing page, privacy page and sign-in journey. The user kept the landing page as it is on 2026-10-25, and `AuthCard` already follows the system. The one exception is the landing screenshots, which show Library and Home and are regenerated at the end.
- The mobile app.
- New features beyond the social Home. Out of scope: web search, a Top Shelf page, recaps, keyboard shortcuts, a collapsible nav, an everyone-feed (it would need a new endpoint) and folding Discover into Games. The Home section brings over what the phone app's Home already has on existing endpoints: feed actions, a Saved list, the awards card, and Top Shelf's popular games.
- The flow changes the review listed separately: #6 (where a new public tier list lands), #8 (Publish position in the quiz editor), #10 (drafts created on click) and #18 (merging Discover with public tournaments).

## Anti-goals

- **A half-done makeover.** Every PR leaves the pages it touches fully on the new frame, and the last PR leaves no page on the old one.
- **Theme or token changes.** Palettes, fonts, decor and the mark live in `packages/shared/src/themes/`, which the phone app imports in 25 files and the backend validates. They stay as they are. The one addition is web-only: a cover shadow, in light and dark versions.
- **Overriding what the owner chose.** Their card style, content width and canvas background still apply wherever they apply today: the Library grid, Series, Collections and the shared library.
- **Changed URLs.** Routes, `?tab=`, `?status=`, `?sort=`, `?action=` and share-link formats stay valid.
- **Breaking phone-width web.** Below `lg` the bottom tab bar and More drawer stay the phone's navigation.

## Navigation (decided by the user)

**A top bar, not a sidebar.** On 2026-10-25 the user picked a header band with a sidebar over a top-nav option. Shown both versions side by side on the canvas, they chose the top bar on 2026-10-30. Covers and murals get the full width, the empty sidebar column goes away, and the account menu, Settings and Admin sit where sites usually put them. Unlike the 10-25 top-nav option, content keeps its full width instead of narrowing to a column.

## The frame

### Desktop (`lg`, 1024px and up): the top bar

A full-width bar, `sticky top-0`, 64px high (`h-16`), above every signed-in page.

- **Background** is `bg` at about 88% opacity with a backdrop blur, plus a `border` hairline under it. Theme decor shows through faintly. Under `prefers-reduced-transparency` it is solid `bg`.
- **Contents, left to right**, inside `px-8` gutters (not width-capped):
  1. `BrandLockup`, linking to `/dashboard`.
  2. The area links: Home, Library, Murals, Games, Reader card, Community. These are `NAV_AREAS` without Settings, from `frontend/src/lib/areas.ts`. Each link is a 44px pill (`rounded-full px-3.5 text-sm font-semibold`). The current area is `accent-soft` with `accent` text and `aria-current="page"`. The others are `text-dim`, turning `surface-hover` with `text` on hover. Home keeps its new-count badge (`newCountLabel`, as in today's sidebar).
  3. The account button, pushed to the right: the avatar at 32–34px in a 44px target, with a chevron. It opens a menu with a non-interactive header row (@username), then My shelf (`/community/u/:username`), Settings, Admin (admins only, as `footerAreas(isAdmin)` decides today) and Log out. Log out is last and set apart; it is not a red-bordered box. While a Settings, Admin or own-profile page is open, the button shows a quiet `surface-hover` state.
- **A "Skip to content" link** comes first in the bar. It is visually hidden until focused and jumps to `<main id="content">`.
- The bar replaces the sidebar entirely at `lg` and up.

### Phone and tablet (below `lg`)

These keep today's navigation: the fixed bottom bar (`BOTTOM_BAR_AREAS` plus More) and the More drawer (`DashboardLayout.tsx:84-157`), restyled only where the new control rules require it. There is no top bar, so the page header is the first thing on the page, as today. `setNavHidden` keeps hiding the bottom bar for the mural and tier list editors.

### Signed-out and public pages

`PublicLayout` gets the same bar at every width; like the signed-in bar, it is sticky only from `lg`. It shows the brand and "Log in" (or "Open my library" for a session without a username), and has no area links. This covers `/shared/library/:token`, `/shared/murals/:token`, `/vote/:code`, `/play/:code` and public `/arena`, plus the signed-out `/work/:id`, `/work/:id/stats` and `/arena/:id`.

**Signed-in viewers of share, vote and play pages now get the app frame** (*my call*). `/shared/*`, `/vote/:code` and `/play/:code` move under `SessionLayout`, which already picks the dashboard frame for a session with a username and the public frame otherwise (`frontend/src/layouts/SessionLayout.tsx:7`). A signed-in reader then never loses their navigation by opening a friend's link. Public `/arena` keeps its redirect for signed-in users.

### Sticky offsets

Things that stick today assume nothing else is pinned: `OfflineBanner.tsx:17`, `SwipeTabs.tsx:111`, `MuralEditorPage.tsx:583`, and the phone-only `Toolbar.tsx:27`. They move to one offset, a CSS custom property that is `4rem` at `lg` and up and `0` below. The same value sets `scroll-padding-top` on `html`, so anchors and focus never land under the bar. `OfflineBanner` sits directly under the bar.

## The page header

`Page` (`frontend/src/components/page/Page.tsx`) keeps its props and gains a `width`. Its markup changes as follows. Pages pass the same `title`, `subtitle`, `back`, `actions` and `tabs` they pass today.

- **No band.** The header sits on `bg` inside the page's width container, so it lines up with the content below. Top padding is `pt-8`, and `lg:pt-10` on desktop.
- **Back link**, optional, sits **above** the title (not beside it): a chevron plus the area or parent name, `text-sm font-semibold text-dim`, 44px high, `-ml-2 px-2`, `text` on hover. `backTo(kind)` in `areas.ts` keeps naming it.
- **Title row**: `flex flex-wrap items-end justify-between gap-4`.
  - On the left are the `h1` and the subtitle under it. The `h1` is in the display font, bold, `text-3xl` (30/36) below `lg` and 40/48 at `lg`, and wraps without clipping. The subtitle is `text-sm text-dim`, one fact, with `mt-1.5`.
  - On the right are the actions: secondary buttons, then at most one primary, `flex flex-wrap gap-2`. On a phone they wrap under the title.
- **Tabs**, optional, `mt-6`: a `nav` of 44px links, `gap-7`, with a `border` hairline under the row and horizontal scrolling when it overflows. The current tab has `text` and a 2px `accent` underline sitting on the hairline (`-mb-px`) and `aria-current="page"`. The others are `text-dim`. The data still comes from each area's `tabs`, and `activeTabTo` still picks the current one.
- **Content** starts `mt-6` below the tabs (or `mt-8` below a header without tabs) and ends with `pb-16`.
- `title={null}` keeps working for pages that place their own `h1` (quiz results, the book page hero, and the profile header below).

### Widths

`Page` takes `width: "wide" | "default" | "narrow"` (*my call* on names). The content and header share one centred container. The widths below are content widths, and the gutters (`px-4 sm:px-6 lg:px-8`) sit outside them, so the mural canvas keeps its full 1152px inside `default`.

| Width | Max | Pages |
|---|---|---|
| `wide` | the owner's `contentMaxWidth` on library pages (default 1600); 1440 elsewhere | Library (Books, Series, Collections, Gallery), shared library, Discover, People, Games lists, Murals list, Admin |
| `default` | 1200 | Home, book and Work pages, Work stats, profiles, tournament view and seed, Reader card, mural editor and shared mural (the canvas stays 1152 inside), tier list editor and vote, Settings |
| `narrow` | 760 | tier list and quiz create wizards, quiz editor, quiz play |

Tabs of one area share one width, so switching tabs never moves the title: People is `wide` like Discover, and Gallery takes the owner's width like the other Library tabs (2026-10-30, found in review). These replace every ad-hoc inner width (`max-w-xl` … `max-w-7xl` in Settings, SettingsAppearance, PlayQuiz, QuizCreate, TierListCreate, QuizEditor, CommunityProfile, OwnShelfView, ReaderCard, MuralEditor, SharedMural and QuizResults; the full list is in the 2026-10-29 Explore report, condensed in "Today's code" below). The Library "Content width" setting keeps changing only the library pages. The Style tab keeps the width that was in force when it opened, as today.

## Visual rules

These come from `DESIGN.md` tokens throughout. Nothing new is added to the palette.

- **Surfaces.** Content sits on `bg`. `surface` with a `border` hairline and 12px radius (`rounded-xl`) is for discrete objects (a game ticket, a person, a mural, a settings group, a side panel) and for **list containers**. A list is one container whose rows are split by `border-t`, each row 44px or taller with `px-4 py-3` and `surface-hover` on hover. One white card per row, as Activity, People and Settings do today, goes away.
- **Type.**
  - Page title: as in the header above.
  - Section heading (`h2`): display font, bold, `text-2xl` (24/32), optionally followed by a count in the text font (`text-sm font-normal text-dim`), and optionally a right-aligned text link ("See all").
  - Panel heading (side panels, settings groups, dialogs): the **text** font at 16/22 bold. `index.css:70-75` forces `h1`–`h3` into the display font today, so this needs an override, for example a `font-text` utility.
  - Body is `text-sm` (14/20).
  - Long-form reading text (synopsis, quotes) is 16px at about 1.7 line height.
  - Meta text is `text-xs`.
  - Labels and buttons are `font-semibold`.
  - Sentence case everywhere.
- **Rhythm.** Sections in a column are 48px apart (`gap-12`). Panel padding is 16–20px. Grids use 20–32px gaps.
- **Covers outside the owner's grid** are drawn by one presentational component (*my call*, name left to the builder) used on Home, the book page hero and edition rows. It draws book corners (`2px 5px 5px 2px`), the new cover shadow (light and dark versions; a dark-scheme theme uses the dark one), and a faint spine shade on the left edge. With no cover image it shows the existing fallback: a plain `surface` tile with the title centred. It wraps the existing `CoverImage` (`frontend/src/components/BookCard.tsx:69`), which already resolves covers and falls back on error, rather than copying that logic. The Library grid, Series, Collections and the shared library keep `BookCard` with the owner's style.
- **Motion.** Cover tiles lift 3px on hover (180ms, `cubic-bezier(0.32, 0.72, 0, 1)`, as in `DESIGN.md` Motion). Under reduced motion they don't move.
- **Focus.** Every interactive element shows the same visible `accent` focus ring.

## One of each control

These go in the existing shared modules (`components/page/buttonClasses.ts`, `components/Toolbar.tsx`) unless the builder finds a better home. Exact names are left to the builder.

| Control | Rule | Replaces |
|---|---|---|
| Primary button | `BUTTON_PRIMARY`, one per view | 13 hand-rolled accent fills (e.g. `NotFoundPage.tsx:10`, `QuizCreatePage.tsx:245`) |
| Secondary button | `BUTTON_SECONDARY` | — |
| Danger button | **new** `BUTTON_DANGER`: filled `danger` with `on-danger` for a confirming action; a `danger`-outlined variant for the "Delete account…" entry point | 5 hand-rolled danger fills (`ConfirmDialog.tsx:79` and others) |
| Icon button | 44×44 round, `surface` + `border`, always with `aria-label` (`toolbarIconClass`, `Toolbar.tsx:69`) | the ad-hoc round buttons in the book page header and the Library More trigger |
| Text field | **new** one class for `input`/`select`/`textarea`: `surface`, `border`, `rounded-lg`, 44px min height, 16px text, `accent` focus border, `danger` on error, label above, hint or error below | 51 of 119 fields repeating the same inline classes (`AddBookModal.tsx:312-372`, `PeoplePage.tsx:17`, `DiscoverPage.tsx:31`) |
| Filter chip | **new** 44px pill. Unselected is `surface` + `border`. Selected is inverted ink: `text` background, `bg` label. Uses `aria-pressed`, with an optional count in `text-dim` | the Library status select, the Discover type filter |
| Menu | `OptionsMenu` | — |
| Dialog | `Sheet` (`radius-lg`, title left, 44px "×" right, footer with Cancel plus one primary) | already everywhere except `ReaderCardViewer` (full-screen viewer), the More drawer and `AddBlockMenu`'s desktop dropdown (a menu, not a dialog; its phone branch is a `Sheet`), which all stay as they are |
| Empty state | `EmptyState`, which already exists | the Arena view bypass (`ArenaViewPage.tsx:189`) and any one-line "nothing here" texts in the pages this work touches |

## Pages

Every page below renders through `Page`. Unless it says otherwise, its title, back link, tabs and actions are the ones it passes today.

### Home (`/dashboard`, `default`)

**Decided with the user on 2026-10-30, replacing the personal Home first drafted here.** Home is social-first and mirrors the phone app's Home (`mobile/src/features/home/`) in parts and look. It is built only on endpoints that already exist. The user ruled out a new endpoint, so there is no everyone-feed: activity comes from people you follow, and suggested readers keep Home from feeling empty. The canvas's "Home" artboard is the reference.

- **Header**: title "Home". The only action is **Saved**, an icon button (bookmark) that opens the saved list, as the app's Home header does.
- **At `lg` and up, two columns**: a main column (`minmax(0,1fr)`) and a 340px side column with a 40px gap. Below `lg` it is one column: the awards card and Games, then the side panels (For you first), then the reading circle. That way For you, and the badge it clears, isn't buried under the whole feed on a phone (*my call*).
- **Main column, top to bottom:**
  - **Awards card**, only while `GET /awards/recent` returns something. This is the app's `AwardHomeCard`: a `surface` row with a `border`, 16px radius, a small cover, the prize line, title and author, and an `accent` shelf line ("Not on your shelf yet" / on your shelf). Its copy comes from the app's award card model, which moves to `@scripta/shared`. The app's monthly recap card stays out, because the web has no recap player.
  - **Games.** A section heading with "Browse all →" (to Discover).
    - "From people you follow": games the people you follow published, taken from the existing Home feed's publication items.
    - "Popular this week": the existing Top Shelf games list (`GET /top-shelf?view=games`), without your own games.
    - If both are empty, show the newest from Discover.
    - Each game is the web `GameTicket` (already a port of the app's ticket): the tinted art column per type, title, author, status chip, numbers, and the dashed footer with its tinted action ("Vote in tournament", "Play quiz", "Rank books"). Show up to two per group in the existing `game-ticket-grid` (`frontend/src/index.css:234`).
  - **Your reading circle.** A section heading with "Find people →". These are the app's feed cards (`HomeFeedRow`) for the circle kinds (`CIRCLE_DIGEST_KINDS`). Each is a `surface` card with a 16px radius:
    - a header with a 36px avatar, the bold name, the event label in `text-dim` under it, the relative time and a Save button;
    - a preview by kind: a book cover with the title in the display font, the author, and **Want to read** (or **Open in your shelf →** when you hold it); a tournament's two tilted covers with "VS"; a quiz's cover fan with the "?" disc; a mural tile;
    - a footer with like (with count), comment (with count) and Share.
    - Like, comment, save, Want to read and share call the app's existing endpoints. Comments open in a `Sheet`. "Load more" pages as today.
  - **Empty circle.** When you follow nobody yet, the app's onboarding copy and a **Find people** primary.
- **Side column, top to bottom:**
  - **For you**: the app's bell list (`PERSONAL_DIGEST_KINDS`) as a list panel. It has a "N new" chip, and each row has a 32px avatar, a bold sentence, the time, and the row's action on the right (**Follow back**, "View results →", or "Following" in `text-dim`). The nav's Home badge counts this list (`personalNewCount`). It is marked seen when its rows are on screen, as the app's Activity screen does.
  - **Your reading**: a slim strip. A panel heading with the count and "Library →", then up to five small book-style covers, each with a 3px progress bar when `readingPercent(book)` is known.
  - **Readers you might like**: up to three of the existing suggested readers (the ones the People page shows), with avatar, name, reason ("You share 4 books") and a **Follow** secondary button, and "See all →" to People.
- **Empty library**: Today's "Start your library" card becomes an `EmptyState` with Import library as the primary and Add a book as the secondary. It takes the reading strip's place.
- **No duplicated logic.** The app's feed-row, activity-row and award-card view models move to `@scripta/shared` and both clients use them, as `AGENTS.md` requires.

### Library area (`wide`, owner's width)

- **Books** (`/dashboard/library`).
  - **Header**: title "Library", subtitle "<library name> · N books", actions More (icon button, the existing menu: sync, import, CSV template, selection, styling, sharing) and **Add a book** (primary), plus the four tabs.
  - **Toolbar**, sticky under the bar: a search field with a leading icon (~340px), status **filter chips** in place of the status select (one per `STATUS_FILTER_OPTIONS` entry with its count from the loaded library, still writing `?status=`), and Sort as a labelled select on the right (still `?sort=`). At phone width the row wraps, and the phone toolbar keeps its existing sticky behaviour.
  - **Grid**: unchanged, with the owner's card style and floor.
  - The `?action=import` panel becomes a proper `surface` panel or `Sheet`, not a bordered div.
- **Series and Collections** (`GroupsPage`). Same header and tabs. Each group is a section, not a white card: a row with the name, a book count and the group's menu, then its covers in the owner's style, with a `border-t` between groups. Empty groups and an empty area use `EmptyState`.
- **Gallery.** Same header. Image grid unchanged. `EmptyState` when there are no images.

### Book and Work pages (`/work/:id`, `/work/:id/stats`, `/book/:key`, `default`)

- `Page` with `title={null}`. The hero holds the only `h1`. This replaces the 10-25 rule that the band took the title.
- **Back link** "‹ Library" above the hero for a signed-in reader. Signed out there is none.
- **Hero at `lg`, two columns, 56px gap:**
  - **Left (260–300px):** the book-style cover, large, with the cover actions in its existing menu (change cover, replace, wrong cover, card style), then the existing stats tiles as one 3-up `surface` strip linking to `/work/:id/stats`.
  - **Right (up to 760px):**
    - Title (display, bold, 48/56) with Share and More as icon buttons at the right of the title row.
    - "by <Author>", 18px, linked as today.
    - One meta line: stars and "4.5 · 109 ratings", first publication year, edition count, in `text-dim`.
    - Genre chips, with possible genres dashed as today, and award pills (`DESIGN.md` AwardPill).
    - The status menu (`accent-soft` with an `accent` border and a check glyph, since it is the page's main control) and the "How it landed" menu (secondary). For a book that isn't in the library, the single primary "Add to library" / "Add this edition" takes their place.
    - The **section tabs as labelled underline tabs**, using the shared model's labels as they are (About · Highlights (N) · Community (N), `packages/shared/src/works/bookScreen.ts:79,112`, which the phone app uses too), replacing today's icon-only segmented control (`BookScreen.tsx:276-299`).
    - The section content: About this book (16px reading text, Show more), Characters, and Editions as a list panel whose rows have a small cover, edition facts and a "Yours" chip.
- **Below `lg`:** stacked. Cover centred at about 200px, then title, meta, controls and tabs, as today.
- `test-work-page.mts` pins the `Finished ▾` glyph and icon tabs. Its assertions move to the new labels.

### Murals (`wide` list, `default` editor)

- **List** (`/dashboard/murals`).
  - Header: title "Murals", actions **Start from a preset** (secondary, replacing today's full-width "Start from a preset" bar) and **New mural** (primary).
  - At `lg`, two columns: a 220px folder list (All murals, the folders, "+ New folder", each a 44px row with `accent-soft` when current) and the main column. The main column has search and sort as one toolbar row with plain sentence-case labels, not uppercase eyebrows, then the mural tiles.
  - Each tile is a `surface` object card with name, "My shelf" chip, block count and updated date, and its menu.
- **Editor** (`/dashboard/murals/:id`).
  - Header: back link "‹ Murals", the mural's name as title (rename as today), and actions with **Done editing** as the one primary in edit mode.
  - The canvas stays 1152px. The editor's own sticky toolbar uses the shared sticky offset.

### Games (`/dashboard/arena` `wide`; detail pages per the width table)

- **List.** Header: title "Games", tabs Tier lists · Quizzes · Tournaments, and one primary action for the current tab ("New tier list" / "New quiz" / "New tournament"). The intro line becomes the subtitle ("Bracket tournaments from your library", with its "browse public tournaments" link). `GameTicket` grid, or `EmptyState`.
- **Detail pages** (tier list editor and vote, quiz create, editor, play and results, tournament view and seed). Back link "‹ Games" (to the right tab, as `backTo` does today), title, and actions with one primary: Start tournament on the seed page, Publish in the editors.
  - The started tournament page uses `default` and centres, which fixes the left-hugging ~290px column.
  - Wizards and the quiz editor use `narrow`.

### Reader card (`/dashboard/reader-card`, `default`)

At `lg`, two columns: the card preview (sticky under the bar, with the You/Visitors toggle and page dots) and the controls column. Controls are grouped in sections with panel headings and keep their current pickers. Below `lg` it stacks as today.

### Community

- **Discover** (`/community/discover`, `wide`). Header: title "Community", tabs Discover · People. A toolbar with the search field and the type filter as **filter chips** (All · Tier lists · Tournaments · Quizzes). `GameTicket` grid.
- **People** (`/community/people`, `default`). Same header. Search field. "Readers you might like" as a grid of person cards (`surface`): 48px avatar, name, reason ("You share 2 books"), a small strip of shared covers, and Follow as a secondary button, since several can show at once. Other lists on the page use list panels.
- **Profile** (`/community/u/:username`, `default`, `title={null}`).
  - A profile header replaces the band title: back link "‹ Community", 72px avatar, `h1` @username in the display font, any existing one-line facts, and the primary action on the same row (Follow or Following for others; the existing owner action on your own).
  - Tabs Mural · Activity · Library are underline tabs at `lg`. `SwipeTabs` stays below `lg`.
  - Published games become a list panel. The mural renders at full content width; today it overflows its column.

### Settings (`/dashboard/settings`, `/dashboard/settings/appearance`, `/dashboard/style`, `default`)

- Header: title "Settings".
- **At `lg`:** a left side navigation (the same three `tabs`, as a vertical list of 44px rows, `accent-soft` when current, labelled Account · Appearance · Library style) and a content column up to `max-w-3xl`. **Below `lg`:** the tabs, as today.
- **Account.** Groups, each a panel heading plus a list panel: Profile (picture, username), Sign-in and email, Socials (toggles), and Delete account (its own panel, with the danger-outlined button). Each row has a label and one-line description on the left and its control on the right. Each button names its object ("Change picture", "Change username"), which closes review #20.
- **Appearance and Style** keep their current controls inside the content column. Style keeps its live preview.

### Admin (`/admin/*`, `wide`)

Header: title "Admin", tabs Genres · Synopses · Translations. Queues are list panels. An empty queue shows `EmptyState`, not a bare "0 to review".

### Public and shared pages

The public bar as above, the same page header, and widths from the table. The shared library keeps the owner's width. The shared mural keeps its canvas width.

### Not found (`*`)

Keeps its centred message, with "Go to your library" as `BUTTON_PRIMARY`.

## Tests and docs

- **Tests that pin the old frame** are rewritten to pin the new one, never deleted. These are `test-page-frame`, `test-sidebar-nav`, `test-controls`, `test-phone-layout`, `test-sheet`, `test-work-page`, `test-game-ticket`, `test-public-layout`, `test-route-tree` and `test-areas` (`frontend/scripts/`). This is a deliberate redesign, so the assertions change with this spec. `frontend/AGENTS.md`'s "fix the CSS, not the assertion" still holds for anything this spec doesn't change. Each rewritten test asserts the new rule.
- **New tests** (same `node:test` + `react-dom/server` style the suite uses):
  - the top bar renders the areas with `aria-current` on the current one, the Home badge, and the account menu items (Admin only for admins);
  - the skip link;
  - `Page` renders one `h1`, the back link above it, actions on the title row, tabs with `aria-current`, and the width class;
  - status chip counts;
  - the routes moved under `SessionLayout`.
- **Browser pass per PR.** Run the fixture site (`node scripts/dev-web.mjs`) and check the touched pages at 1440×900, 1280×800, 1024×768 and 390×844, in Light, Dark and one decor theme (Synthwave or Oxblood). Screenshots go to the PR.
- **Landing screenshots** are regenerated once Library and Home have landed (`npm run screenshots:landing --workspace frontend`; it needs network).
- **`DESIGN.md`** "Layout", "The frame", "Page frame (web)" and the control rules are rewritten to this design. `frontend/README.md:7,17,58` is already stale; it is corrected in the same pass. The live design-system artifact is updated after that, from `DESIGN.md`, with the user's go-ahead. The artifact itself is stale against the code, too: its accent is `#a85c32` where the code has `#97532d`, and it lists two themes where the code has eleven.
- After the last PR, the plan ends by asking the user to dispatch `site-ui-reviewer`. Only the user dispatches it.

## Constraints

- Repo rules apply (`AGENTS.md`, `frontend/AGENTS.md`): minimum code, reuse before adding, no speculative options, no comments.
- Logic that the phone app also needs goes in `@scripta/shared`. The status counts are the likely case: check `packages/shared/src/library/libraryView.ts` before writing a helper.
- Tailwind v4 with no config file. Code uses the `bg-(--color-…)` form, which stays.
- No new dependencies.
- Every PR runs `node scripts/gate.mjs`: typecheck, lint, `npm test --workspace frontend` and the shared build.

## Delivery order (*my call*; each PR leaves the pages it touches complete)

1. **Frame.** The top bar with account menu and skip link, public bar mode, routes moved under `SessionLayout`, the new `Page` header, widths on every page, the sticky offset, the control classes, the panel-heading font override, the cover shadow and the book-style cover component. Every page picks up the new header through `Page` in this PR, and every page gets its width.
2. **Library area and book page.**
3. **Home**, in two PRs: (a) the layout, the games, the circle feed cards (read-only), For you, the reading strip, suggestions and the awards card, with the view models moved to shared; (b) the feed actions (like, comment `Sheet`, save and the Saved list, Want to read, share).
4. **Community and Games.**
5. **Murals, Reader card, Settings, Admin, public pages, Not found.**
6. **Docs and screenshots**: `DESIGN.md`, `frontend/README.md`, landing screenshots, then ask for the `site-ui-reviewer` pass.

## Left to the builder

- Component names and files: whether the top bar lives in `DashboardLayout` or a new shell component shared with `PublicLayout`, the cover component's name, and the control classes' names.
- The exact Tailwind spelling of the translucent bar, the sticky offset property and the cover shadow.
- Whether filter chips use `aria-pressed` buttons or a radio group, as long as the state is announced.
- How each PR splits into tasks.
- The account menu's popover. `OptionsMenu` if it fits, else the same shape.

## Today's code, for orientation

- `frontend/src/App.tsx:57-122` declares every route. Nothing is lazy-loaded.
- `DashboardLayout.tsx:46-68`: the sidebar is `hidden w-56 … lg:flex` with no sticky. `:84-157` holds the bottom bar and More drawer.
- `PublicLayout.tsx:12-20`: brand plus "Log in".
- `Page.tsx`: `title`, `subtitle`, `back`, `actions`, `tabs`, `maxWidth`. The band is at `:25-35`; actions, tabs and body follow at `:36-57`. `PageWidthContext` defaults to 1600 and only `PublicLayout` provides it. The owner's width reaches a page only through `maxWidth` (`LibraryPage.tsx:356`, `GroupsPage.tsx:316`, `SharedLibraryPage.tsx:38`).
- Pages that set their own inner width inside `Page`:
  - SettingsPage:68, SettingsAppearancePage:9, PlayQuizPage:94 (`xl`);
  - QuizCreatePage:147, TierListCreatePage:44 (`2xl`);
  - QuizEditorPage:132 (`3xl`);
  - CommunityProfilePage:69,145 and OwnShelfView:118,191 (`3xl`/`4xl`);
  - ReaderCardPage:49 (`7xl`);
  - MuralEditorPage:597, SharedMuralPage:108 (`6xl`);
  - QuizResults:76 (`lg:6xl`).
- Tokens: `frontend/src/themes.css` is generated from `packages/shared` (`npm run themes --workspace frontend`, guarded by `test-themes-css`). `index.css:70-75` sets `h1`–`h3` in the display font. Decor is `body::before` (fixed, `z-index:-1`).
- Tests: `npm test --workspace frontend` runs 67 `node:test` files (263 tests). None of them render in a browser. About 16 pin class strings.
