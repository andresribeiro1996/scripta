# Mobile Home: Cover story refresh

Agreed with the user on 2026-11-15. Mobile only (`mobile/src/features/home/HomeScreen.tsx`).

## Why

The user chose the "Cover story" Home concept (pack: `~/.codex/visualizations/2026/10/26/01a175c0-e0c5-7f41-85a7-974e47fa1eee/atmyshelf-home-review-2026-11-15.zip`, screenshot `cover-story-390-light.png`). They want the Daily Chapter and community games to stand out more, and they also want to see what they're reading. The concept is inspiration only. Its layout, copy and fixture data are not a spec.

## Goals

- The Daily Chapter becomes the large card at the top of Home, with one clear button.
- After you play, the card shows today's score instead of asking you to play again.
- A new "New games" section shows the two newest public games.
- A compact "Currently reading" row shows the book you read most recently.
- Section headings get the editorial look: larger, in the theme's display face.

## Anti-goals

Taking any of these into the build counts as a failure:

- **Losing anything Home has today.** The header stays: the brand mark, plus Daily Chapter stats (when you have chapters), the activity bell with its badge, and saved. So do the `RecapHomeCard`, the `AwardHomeCard`, the no-library onboarding, and the full reading-circle feed with likes, comments, paging, pull to refresh, and its empty and error states.
- **The concept's search and avatar header buttons.** Both duplicate tabs.
- **The concept's fixture content:** the "No. 04" issue number, "Today's plot.", "By Atmyshelf", invented headlines, and engagement numbers.
- **The ↗ arrow glyph.** Everything opens in the app, so rows use ›.
- **A hard-coded serif or hex colour.** There are 11 themes, and the user can choose fonts per account.

## Non-goals

- Web Home (`frontend/src/pages/HomePage.tsx`).
- A popularity or "hottest" ranking. The section is newest-first. A ranking may come later as separate backend work.
- Backend or shared API changes. Every endpoint and client call this needs already exists.

## Constraints

- **Colours come from `ThemeColors`.**
  - The light theme's background `#f2f0ec`, accent `#97532d` and `accentSoft` `#f1e2d8` already give the warm look.
  - No new token.
- **Headings use `<Text display>` or a size of at least 18**, which picks the theme's display face automatically.
  - On light this is Playfair.
  - Other themes and user overrides keep their own face.
- **Every string goes in both `en` and `pt-PT`.** `community.i18n.test.ts` and the other locale-parity tests enforce this.
- **Text supports dynamic type** (`{...dynamicType}`), and touch targets are at least `minimumTouchTarget`.
- **Logic that can be pure lives in a model file tested with `node --test`.** That covers picking the reading book, picking the card state, and row text. This is the existing pattern (`feedRowModel.ts`, `arenaHome.ts`). Mobile has no component render tests.

## Approaches

1. **Restyle and extend Home in place.** This is the one chosen.
   - Restyle `DailyChapterCard`, which only Home uses.
   - Add two small components to Home's `ListHeaderComponent`.
   - The feed and header are untouched.
2. **Rebuild Home as a new screen following the concept's layout.** Rejected: it would drop or reshuffle current features, which is the anti-goal.
3. **Reuse `DiscoverRow` for the games and the mural's reading block for the book.** Rejected: `DiscoverRow` is a full game ticket with an action footer, too heavy for a Home section. The mural reading block is a cover row, not a list row.
   - Its parts are reused instead: `GameTicketArt`, `contentTarget`, `readingPercent`, `BookCover`.

## Layout

Top to bottom in `ListHeaderComponent`, then the existing feed:

```
[header: brand mark          stats  bell  saved]   unchanged
┌ Daily Chapter ─────────────────────────────┐
│ THE DAILY CHAPTER                     [art]│
│ <board.title, display face, large>         │
│ 5 questions · About 2 minutes              │
│ [ Play today's chapter              › ]    │   or [ You scored 4/5 · See results › ]
└────────────────────────────────────────────┘
RecapHomeCard / AwardHomeCard                    unchanged, when present
No-library onboarding                            unchanged, when present
New games                              See all ›
[fan] Quiz · Guess the classic                ›
      by @joao · 248 plays
[fan] Tournament · The fantasy final          ›
      by @marta · 16 books
[cover] Currently reading · 54%               ›
        Piranesi · Susanna Clarke
Your reading circle                 Find people →  existing section, heading restyled
...feed...
```

## Daily Chapter card

- **Data.**
  - Today's chapter comes from the existing `["daily-chapter","today"]` query, which already has a 60 s refetch.
  - It renders nothing when there is no board, as today.
- **Surface.**
  - The background is `accentSoft` with `radii.xl`, and padding at least `spacing.lg`.
  - Above it sit a caption with `quizzes.theDailyChapter`, `board.title` at heading size in the display face, and the existing `quizzes.dailyCardMeta` line.
- **Art.** `DailyChapterArt` keeps its fixed size and sits in the top-right.
  - At large dynamic-type sizes it may move above the text, or be hidden.
  - That choice is the builder's, as long as the title never shares a line with clipped art.
- **Button.**
  - A full-width filled button with an `accent` background and `onAccent` text.
  - Pressed uses the existing pressed treatment. Prefer an existing button from `mobile/src/ui` over a new one.
  - Unplayed: "Play today's chapter".
  - Played: "You scored {score}/5 · See results". It goes to `/daily` in both cases, where results already show.
  - The `accessibilityLabel` keeps naming the chapter title.
- **Played state.**
  - Use the same history query `/daily` uses: `daily-chapter-screen.tsx:25`, key `["daily-chapter","history", user?.id ?? "guest", identity, date]`.
  - Lift it into a small shared hook so Home and `/daily` share the cache. The played state then works for guests too, since their history is kept by device ID. *My call; the user had accepted "guests always see Play", and this is strictly better at the same cost.*
  - The hook's inputs are the same ones `/daily` uses:
    - `useAuth()` for `ready`, `unreachable` and `user`.
    - `useDeviceIdentity()` for the device ID.
    - The today query's `date`.
  - Today's result is `results.find(r => r.editionId === board.id)`.
  - Its `score` is out of 5. Every chapter has 5 questions (`dailyChapter.ts`, and the existing `quizzes.chapterComplete` string is "{score}/5").
  - While history is loading or has failed, show the unplayed button. A failed history load must not hide or break the card.
  - Leave `useDailyHistory` (signed-in only, used for the header stats button) as it is unless it merges cleanly into the new hook. Builder's call.
- **Strings.** New keys for the two button labels, in en and pt-PT. Retire `quizzes.dailyCardOpen` if nothing else uses it.

## New games

- **Data.**
  - `GET /community/discover`, which is already newest-first across tierlists, tournaments and quizzes (`backend/src/modules/community/service.ts:492-513`).
  - Home calls the existing `fetchDiscover("all", "", 0)` unchanged and shows the first two items.
  - Its own query key is `["home", "new-games"]`, so it never mixes with Browse's paged cache.
  - Why no `limit` argument: `fetchDiscover` drops unknown kinds after the fetch (`api.ts:44`). A limit of 2 could then show fewer games than exist, and the default page of 20 is small. *My call.*
- **Visibility.**
  - Hidden when the request returns no items or fails. A failure is not worth an error block on Home.
  - Loading shows a short `Skeleton`.
  - Refetched on focus and pull to refresh, alongside the existing Home queries.
- **Heading.** "New games", display face, with a "See all ›" link to the Games tab's Browse pane.
  - The route is `/my-arena`, the Games stack's initial route, which opens on Browse by default.
  - Use `router.navigate("/my-arena")`, not `push`, so expo-router switches to the Games tab rather than stacking the screen on Home. The app has no tab-switch helper today.
  - Confirm on device.
- **Row.** It is pressable, opens `contentTarget(content)`, and has a › at the end. Left to right:
  - `GameTicketArt` (cover fan) at a compact size.
  - The kind label (existing `community.kindQuiz` / `book.gameTournament` / `book.gameTierlist` style keys).
  - The game name, one line, truncated.
  - The meta line "by @username · {count}". The count is:
    - plays for a quiz (`playCount`)
    - votes for a tier list (`ballotCount`)
    - books for a tournament (`bookCount`)
  - Reuse existing plural count strings where they exist.
  - An unavailable author falls back the way `DiscoverRow` already does.
- **Model.** Put the row text (kind label key, count text) in a pure function with tests. `communityHome.ts` or `arenaHome.ts` may already have most of it, so look there first.

## Currently reading

- **Data.** The library is already loaded on Home (`useHomeActions` → `actions.library`).
- **Which book.** Pick the books with `ReadStatus === 1` and show the one with the latest `DateLastRead`.
  - Books without a date sort last.
  - Ties keep library order.
  - Put this in `@scripta/shared` next to `readingPercent` (`packages/shared/src/library/libraryView.ts`) as one small helper with tests. The mural's inline `ReadStatus === 1` filter may switch to it if that's a one-line change.
- **Visibility.** Hidden when the library is missing, empty, or has no book marked reading. The no-library onboarding already covers the empty case.
- **Row.**
  - `BookCover` at a small size.
  - The caption "Currently reading" (reuse `murals.currentlyReading` if it reads right in context, otherwise a Home key), with " · {percent}%" only when `readingPercent` is not null.
  - "Title · Author" on one line, truncated.
  - A › at the end.
  - It opens `/book/{bookKey(book)}`, the same route Library uses.

## Reading circle heading

- The existing section header keeps its text, link and behaviour.
- Only the title changes, to the same display-face heading style as "New games", so the two sections match.
- Extract a shared `HomeSectionHeader` only if both headings end up identical.

## Verification

- The pure helpers have tests: the reading pick, the card state from history, and the game row text.
- Run mobile and shared `typecheck` and `test`, and the i18n parity tests.
- Device pass via `device-checker`, in light and dark theme plus one non-serif theme:
  - Home with a played and an unplayed chapter.
  - Games present and absent.
  - A reading book with and without a percent.
  - Largest text size.
  - "See all" lands on the Games tab.

## Left to the builder

- Exact sizes of the art, covers and fan in the rows.
- Whether the hero art moves or hides at large text.
- Which existing button component to use.
- Where the new pure helpers live, within the files named above.
- Whether the history hook merges with `useDailyHistory`.
