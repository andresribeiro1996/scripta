# My shelf, release 1

## Context

The 2026-09-24 product review ([artifact](https://claude.ai/artifact/7v7RkbHXPJBjxXGZsETfoj))
found that the mobile app is arranged around publishing and following rather
than the reader's own books:

- The full library sits behind Profile → ⋯ → Manage library…; Profile's
  Library tab is the public, read-only view.
- A reader who never publishes has no profile page at all:
  `getProfileByUsername` 404s for the owner too, so the Profile tab is only a
  "publish your profile" gate.
- Mobile Home builds Currently reading and Up next cards and never renders
  them. The 2026-09-18 spec asked for "your reading state, and what the people
  you follow did"; only the second half shipped.
- Finishing a book is one cycling "Mark as …" button. It saves no date, so the
  "Finished this year" stat skips in-app finishes, and nothing marks the
  moment.
- Presets are buried, written in Portuguese, and on a library without ratings
  produce a mural of instructions.

Release 1 turns the Profile tab into **My shelf**, a private-by-default
personal space built from the reader's own books, and makes finishing a book
a small moment that adds to it. The reader card is release 2.

## Decisions locked in with the user

- **Profile becomes My shelf** on mobile. Same tab slot, still five tabs. On
  web, the sidebar's "Your profile" link becomes "My shelf"; Library stays in
  the sidebar.
- **The owner always sees their shelf.** The profile mural is the shelf,
  whether or not it's published. Publishing stays opt-in, and nothing is
  published automatically.
- **The feeling is the existing `Rating`.** Five labelled choices map to 1–5.
  No new mood field.
- **It works with no followers.** Nothing in this release depends on
  following anyone or prompts the reader to share.
- **No new top-level sections, services or packages.**

## Concept model

| Surface | Before | After |
|---|---|---|
| Mobile tab | Profile (publish gate if private) | My shelf: Shelf / Library / Activity, private by default |
| Owner's mural | Visible only after publishing | Visible to the owner always; published is a state, not a gate |
| Mobile Home | Follower tabs fill the screen | Reading now, Rediscover, Up next, then a compact follower section |
| Book status | Cycling "Mark as …" button, no date | To read / Reading / Finished control; finishing saves the date |
| Finishing | Label flips | Optional moment: feeling, thought, one comparison; the book lands on the shelf |
| Presets | 3, Portuguese, instruction blocks | English, no instruction blocks, plus a "My shelf" preset offered on first visit |

## 1. Status and finish date

### Shared (`@scripta/shared`)

- `setReadStatus(book, status, day)` returns a new book with `ReadStatus`
  set. When moving *into* Finished (`status === 2` and the book wasn't
  already 2), it also sets `DateLastRead = day` and `___PercentRead = 100`.
  Any other change only sets `ReadStatus`: leaving Finished keeps
  `DateLastRead`, because Kobo and Goodreads imports use it as history. If the
  status is unchanged, it returns the same object so callers can skip the
  save.
- `localDay(now = new Date())` returns the local `YYYY-MM-DD`, used as `day`.
- The label for status 0 becomes **"To read"** everywhere: `statusLabel`,
  `STATUS_FILTER_OPTIONS`, and the three add-book forms. Filter values and
  stored numbers don't change.
- `nextReadStatus` is deleted once neither client cycles statuses.

### Mobile

`BookDetail` replaces the "Mark as …" button with the existing native
`Segmented` control (To read / Reading / Finished). `useLibraryActions`
exposes `setStatus(book, status)` built on `setReadStatus`. Style and Cover
stay as they are.

### Web

`BookDetailSheet` replaces its "Mark as …" button with three toggle
buttons (`role="group"`, `aria-pressed`) in the web's existing segmented
style, the one `TierlistResultsView` and `ArenaViewPage` use. There's no
arrow-key selection, because every selection saves.
`LibraryPage.handleSetBookStatus(book, status)` uses `setReadStatus`.

No backfill: finished books without a date stay as they are.

## 2. Home leads with your books

### Mobile

`HomeScreen` becomes one vertical scroll:

1. **Reading now (count)**: covers from the existing `currentlyReading`
   dashboard card.
2. **Rediscover**: the existing quote card, unchanged.
3. **Up next (count)**: the first 10 books of the `upNext` card.
4. **From people you follow**: the first 3 digest items, rendered with the
   existing `FeedRow`, and an "All activity" link. With no digest items, the
   section is a single "Find readers" row.

"All activity" and "Find readers" push a new `(home)/activity` route, which
holds today's Activity / Discover / Find people `SwipeableTabs` moved over
as-is. "Find readers" opens it on Find people. The new-activity count moves
to the section header on Home ("From people you follow · 3 new"), and
`markDashboardSeen` now runs when the activity screen opens, not when Home
loads, so the count clears only once the reader has actually looked.

Tapping a cover opens that book's sheet **over Home**, and back returns to
Home. The plan picks the mechanism (an expo-router shared route across the
`(home)` and `(library)` groups, like `/u/[username]`).

The "Start your library" empty state for an empty library is unchanged.

### Web

`HomePage` already puts the reader's rows first. Covers currently do nothing
when clicked. They navigate to `/dashboard/library?book=<key>`, and
`LibraryPage` opens `BookDetailSheet` for a `book` search param the way it
already handles `action`. Closing the sheet removes the param.

## 3. My shelf

### Backend (community module)

- **`GET /community/profile`** (authed) returns the caller's own state,
  published or not: `{ muralId: string | null, published: boolean,
  feedSettings }`. If there's no profiles row: `muralId: null, published:
  false`, default feed settings.
- **`PUT /community/profile/mural`** (authed, `{ muralId }`) sets the shelf
  mural without changing `published`. It checks ownership
  (`MuralNotOwnedError`) and upserts the row (`published: 0` for a new row;
  `published_at` untouched). If the profile is published and the mural
  changed, it emits `mural_published`, as `publishProfile` does.
- **`getActivity`** lets the owner read their own activity while unpublished
  (`viewerId === userId`). Visitors still get 404.
- `getProfileByUsername` is unchanged: visitors never see a private shelf.
- Tests: service and route tests for both endpoints and for owner activity.

### Shared

An `OwnProfile` type for the `GET` response in the community types. Each
client gets `fetchOwnProfile()` and `setShelfMural(muralId)` in its community
API.

### Mobile

- Tab title **"My shelf"**, with a shelf or books glyph from the `IconName`
  vocabulary (added if missing). `(library)/me.tsx` renders a new
  `MyShelfScreen`. `ProfileScreen` stays for `/u/[username]` (visitors).
- **Header:** title "My shelf". On the right, a status chip, **Private** or
  **Published**, which opens the publish or unpublish confirmation, and a ⋯
  menu: Edit shelf (→ `/murals/<id>`), Manage library… (→ `/library`), Switch
  shelf mural… (picker → `setShelfMural`), Feed settings…
- **Publish** confirms first: "Publish your shelf? It becomes a public page
  at /u/<name>, and people can follow you." Then it calls the existing
  publish endpoint with the shelf mural. Unpublish uses the existing confirm
  dialog.
- **Tabs:** `SwipeableTabs` with Shelf | Library | Activity. The last tab
  used is remembered for the app session (in memory, not persisted).
- **Shelf page:** if the shelf mural has blocks, it renders read-only with
  `MuralCanvas` from the owner's own data, the same sources the mural editor
  uses (own library, gallery images, tierlists, own `ReaderProfile`), not
  the redacted public payload. Otherwise: an empty state with **Create your
  shelf**, replaced in PR 4 by the first-visit preview.
- **Library page:** the owner's books in a pane. A search field, status
  filter chips with counts (All / Reading / Finished / To read, via
  `filterBooks` and `STATUS_FILTER_OPTIONS`), the existing `LibraryGrid` with
  the owner's style, tap → book sheet, and an add button → `/add-book`. Bulk
  operations stay in the full editor behind Manage library… The pane uses
  chips, not nested swipe tabs, so it never fights the outer swipe.
- **Activity page:** the existing `ActivityList`.
- **Murals list:** the shelf mural's badge reads **"My shelf"**, sourced from
  `fetchOwnProfile()` so private shelves are badged too. The badge no longer
  overlaps the row's ⋯ button.

### Web

- Sidebar: "Your profile" becomes **"My shelf"** (same `/community/u/:me`
  route).
- `CommunityProfilePage`, when `isOwnHandle`: load `fetchOwnProfile()` and
  render the owner's shelf from their own data, whether published or not.
  The Private/Published chip and Publish button replace the "Your profile
  isn't published" gate. The visitor view is unchanged.
- Murals list: the same "My shelf" badge.

## 4. Presets and the My shelf preset

### Shared (`murals/presets.ts`, `murals/murals.ts`)

- Shelf blocks gain an optional **`role?: "finished" | "favourites"`**. The
  backend stores blocks opaquely and the public payload passes the field
  through. The plan verifies both editors keep it when a block is edited.
- All presets follow three rules:
  1. No instruction or help-text blocks. The `note` blocks go.
  2. A block whose data is empty is left out.
  3. Text blocks span at least 6 of 12 columns, which fixes mid-word breaks
     at phone width.
- `MURAL_PRESETS` in English:
  - `best`: "All-time favourites", "The books that stayed with you."
  - `recent`: "Recently finished", "Your last pages, newest first."
  - `next`: "Want to read", "Stories waiting their turn."
  - `shelf` (new): "My shelf", "What you're reading, what you've finished,
    and a passage to revisit."
- Existing heading copy is translated to English.
- `presetAvailability(id, books)` returns `null` or a reason the preset would
  be empty, e.g. "Needs books rated 4 or 5", "Needs finished books", or
  "Needs books on your to-read list". Pickers disable such presets and show
  the reason instead of creating an empty mural.
- `buildMuralPreset("shelf", books)`, top to bottom on the 12-column grid,
  each block only when it has data:
  1. `profile` (avatar, shelf theme)
  2. `stats`: books, finished, reading
  3. `currentlyReading`
  4. `shelf` with `role: "finished"`, "Finished": finished books, known
     `DateLastRead` newest first, then the rest in library order
  5. `quote` with `mode: "rediscover"`, when any highlight is eligible
  6. `shelf` with `role: "favourites"`, "Favourites": books rated 4–5,
     highest first

  The last two sit side by side when both exist. The plan settles heights
  with the existing block-height helpers.

### Mobile and web

- **First visit:** if the Shelf page has no shelf mural, or one with no
  blocks, it previews `buildMuralPreset("shelf", ownBooks)` read-only with
  "Made from your N books: X you're reading and Y you've finished. Only you
  can see it."
  - **Keep this shelf:** creates a "My shelf" mural if needed, saves the
    blocks, then `setShelfMural`.
  - **Start blank:** creates or keeps an empty mural as the shelf and opens
    the editor.
  - An empty library shows "Start your library" (import or add) instead.
- **Murals screen:** the empty state gains a "Start from a preset" button.
  Preset sheets and pickers show each description and any disabled reason
  (mobile `MuralsScreen`, web `MuralPresetPicker`, whose copy also moves to
  English).

## 5. The finishing moment

### Shared

- `FINISH_FEELINGS`: 1 "Not for me", 2 "Fine", 3 "Good", 4 "Loved it", 5
  "All-time".
- `setRating(book, rating)` sets `Rating` (1–5).
- `addReaderNote(book, text, day, id)` appends `{ BookmarkID: "note:<id>",
  VolumeID: <ContentID>, Text, Annotation: "", Type: "review", DateCreated:
  day, DateModified: null, ChapterProgress: null }`. That's the shape
  Goodreads reviews already import as, so it lists under Highlights and a
  quote block can place it. Rediscover ignores it (`Type !== "highlight"`).
- `shelfAfterFinish(blocks, key, rating)` only acts on a shelf that came
  from the My shelf preset, meaning it has a `role: "finished"` shelf block.
  It moves `key` to the front of Finished (deduped). If `rating >= 4` and
  there's no favourites shelf, it appends one containing `key` below the
  lowest block. It returns `{ blocks, landed: ("finished" | "favourites")[] }`.
  Blank or hand-made shelves are never modified.
- `favouriteOpponent(blocks, key)` returns the first favourites book that
  isn't `key`, or `null`.
- `promoteFavourite(blocks, key)` moves `key` to the front of Favourites.
- Unit tests for each helper.

### Behaviour, both clients

- It opens **only** after the reader moves a book to Finished with the
  status control and the save succeeds. Never for imports, merges or bulk
  edits.
- Shelf update: when it opens, `shelfAfterFinish` runs on the shelf mural
  (from `fetchOwnProfile()`), and if anything changed the mural is saved.
- Layout: eyebrow "Finished · <date>", cover, title and author, and **Done**
  always visible at the top right. Three optional rows:
  1. **How did it land?** Five chips. A tap saves the `Rating` at once and
     shows "Saved as your rating".
  2. **A thought to keep.** A text field, saved as a reader note when the
     sheet closes, by Done or dismissal, if it isn't empty.
  3. **Against your favourite.** Only when `favouriteOpponent` finds a book.
     Two covers, "This one" (→ `promoteFavourite`, then save the mural) or
     "Still <title>" (no change). One choice.
- The footer line comes from `landed`: "Added to Finished on your shelf",
  "…and to Favourites". Nothing when `landed` is empty.
- The book sheet gets a **How it landed** row with the same five chips for
  finished books, so a rating can change later.
- Privacy: the moment publishes and shares nothing. The existing
  `book_finished` event still reaches followers only when the reader has
  switched on "reading" in feed settings (off by default). The sheet never
  mentions followers.
- Mobile: a `book/[key]/finished` route presented as a sheet, in whichever
  stack hosts the book sheet. Web: a `FinishSheet` component opened by
  `LibraryPage`.

### Carried over from PR 1's final review

- Open the moment only after the save succeeds. Web's
  `handleSetBookStatus` currently turns failures into a toast and returns
  nothing, so it needs to report success first. Mobile's `run` already
  does.
- Parse `DateLastRead` as a local date (`new Date(y, m - 1, d)`), not
  `new Date("YYYY-MM-DD")`, which reads as UTC and shows the previous day
  west of UTC.
- A mis-tap on Finished overwrites `DateLastRead` and progress. The
  moment's Done/undo design should account for that.
- Device pass: include a failed or slow status save. iOS's native picker
  keeps the tapped option after a failure.

## Delivery

Five PRs, each through the normal workflow and verified before merge:

| PR | Scope | Depends on |
|---|---|---|
| 1 | Status and finish date (shared, mobile, web) | none |
| 2 | Home leads with your books (mobile, web) | none |
| 3 | My shelf (backend, shared types, mobile, web) | none |
| 4 | Presets and the My shelf preset, first visit | 3 |
| 5 | The finishing moment | 1, 3, 4 |

PRs 1–3 can run in parallel.

## Verification

- Shared: `npm run build --workspace @scripta/shared` and `npm test
  --workspace @scripta/shared`.
- Backend (PR 3): `npm run typecheck --workspace backend` and `npm test
  --workspace backend`, with the env preamble CI uses. `config/env.ts` exits
  at import time without it.
- Web: `npm run typecheck --workspace frontend`, `npm run lint --workspace
  frontend`, `npm test --workspace frontend`.
- Mobile: `npm run typecheck --workspace mobile`, `npm test --workspace
  mobile`, `cd mobile && npx expo-doctor`.
- Device: PRs 2–5 end with one emulator pass through the changed screens
  (`node scripts/dev-status.mjs --json` first, per `docs/dev-workflow.md`).
  The dev fixture has no ratings, dates or highlights, which exercises the
  empty paths. Rate and finish a book in-app to exercise the full ones.

## Out of scope

- The reader card and `readerIdentity()`: release 2.
- Pick my next read: release 2.
- Taste connections, mood tags beyond the five labels, goals, streaks, share
  images.
- Remembering the My shelf tab across app launches.
- A Library section on web (the sidebar already has one).
- Backfilling dates or ratings for existing books.
