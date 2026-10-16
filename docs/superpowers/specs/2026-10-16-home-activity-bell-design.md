# Home activity bell

## Problem

A 2026-10-16 UI review of the mobile Home tab, on the signed-in fixture, found these problems:

- **Notifications bury the feed.** "Around your shelf" holds follows, plays of your games and finished tournaments. It always sits first (`mobile/src/features/home/homeModel.ts:3-7`), and its items stay for 30 days whether seen or not (`FEED_WINDOW_MS`, `backend/src/modules/community/domain/feed.ts:33`). With a few of them, "Your reading circle" starts at the bottom of the first screen.
- **The same play shows twice.** When a follower plays your quiz, the digest returns a `vote` row ("played a quiz → Play quiz") and a `participation` row ("played your quiz → View results"). `getDashboard` merges the inbox and participation rows without dedupe (`backend/src/modules/community/service.ts:320-336,470-497`).
- **Posts are tall.** The heading, the text link and the reaction buttons each force a 44pt minimum height (`mobile/src/features/home/HomeFeedRow.tsx:65-89`). A reading or quiz post is about 265pt, and a follow is about 141pt for one line of information.
- **Previews don't line up.** A quiz with no covers puts a 32pt trophy in the middle of an empty 86pt slot (`FeedPreview.tsx:27`), while a book uses a 48pt cover. Titles therefore start at different x positions.
- **Links come in four styles.**
  - "Play quiz →" and "View results →" are bold with an arrow (`HomeFeedRow.tsx:28`).
  - "Want to read" and "Follow back" are bold without one (`:50,54`).
  - "Find readers" is regular weight (`HomeScreen.tsx:77`).
  - "Want to read" sits under "finished reading" and reads as a status, not an action.
- **"Follow back" is a left-aligned text link** in the reactions row (`HomeFeedRow.tsx:54`). A follow you already returned shows nothing.
- **Notifications carry post furniture.** A participation row has a bookmark and a lone Share. Its subtitle repeats the actor's name (`feedRowModel.ts:79`).
- **Zero counts show.** Like and comment counts render "0" (`HomeFeedRow.tsx:56-57`).
- **One verb is green.** "finished reading" is the only green verb (`HomeFeedRow.tsx:36`).
- **Counts don't pluralise.** `contentDetail` prints "1 plays", "1 ballots", "1 questions", "1 books" (`packages/shared/src/community/helpers.ts:34,38`).
- **Order looks wrong.** In both captured sections a "5m ago" item sat above "3m ago" items. The server sorts newest-first (`service.ts:220,321`), so the cause is unknown.

## Decisions

- **Personal items move behind a bell.**
  - Home shows the reading circle only.
  - A bell in the Home header opens a new Activity screen holding follows, plays of your games and finished tournaments.
  - The bell carries the unread count, and the Home tab badge stays.
- **One seen timestamp, owned by Activity on mobile.**
  - `users.dashboard_seen_at` stays the only seen state, with no database change.
  - The Activity screen marks seen. Home stops marking seen and loses its per-post "new" dots, since only Activity and web now move the timestamp.
  - Seeing items on web clears the mobile bell. Opening Activity on mobile clears web's "New" chips, circle posts included. This is intended: one account, one seen state.
- **A play of your own game shows only in Activity.**
  - Whenever the client sends `kinds`, the digest drops `voted_on` events on games the viewer owns.
  - Only the legacy request with no `kinds` keeps them. Every client that sends `kinds` has included `participation` since `kinds` was introduced (`3c76a93e`), so none of them loses the event.
  - A promoted tier list is the exception. Its `ownerUserId` stays the original creator, but participation rows exclude promoted lists, so votes on it are kept.
- **One rule for actions.**
  - An action that changes something in place ("Want to read", "Follow back") is a secondary `Button`.
  - An action that opens a screen is a bold accent link ending in "→".
  - Exception: the invitation on a published game that is still open ("Rank this list", "Play quiz") stays a filled primary `Button`. It is the post's whole point, and it is the only filled button in the feed.
- **Activity rows are not posts.** They have no bookmark, Share, like or comment, and no preview art.
- **Web keeps its single combined list.** It gets the dedupe and the plural fix from the backend and `@scripta/shared`, with no web UI change.
- **Old installed mobile builds are unaffected.** They request all kinds and mark seen on Home, and both still work.

## Scope

1. **Backend:**
   - In `getDashboard`, when the client sent `kinds`, a `voted_on` event on a game the viewer owns produces no item. A promoted tier list doesn't count as owned.
   - The vote branch of `toDigestItem` (`service.ts:282-291`) is the place. Its "no ownership check" comment goes.
   - The community dashboard bullet in `backend/README.md` records the rule.
2. **Shared:**
   - Export one `plural(count, one, many)` and replace the private copies in `works/bookStats.ts:16` and `library/readerIdentity.ts:41`.
   - `contentDetail` uses it for books, ballots, questions and plays.
   - `dashboardQuery` and `fetchDashboard` take an optional `kinds`. Two lists are exported:
     - `CIRCLE_DIGEST_KINDS`: publication, vote, reading, mural, started
     - `PERSONAL_DIGEST_KINDS`: follow, participation, completion
   - Calls without `kinds` keep today's query.
3. **Mobile data:**
   - The Home feed query requests circle kinds.
   - A new Activity feed query requests personal kinds, with its own query key.
   - The bell and the Home tab badge (`mobile/src/app/(app)/_layout.tsx:29-30,53`) read `personalNewCount` from page 0 of the Activity query, through `newCountLabel`.
   - `clearDashboardCounts` applies to the Activity query after a successful mark-seen.
4. **Bell:**
   - A `bell` glyph in `GLYPHS` (`mobile/src/ui/icon.tsx`).
   - The Home header becomes brand mark, then an "Activity" `IconButton` (bell glyph, `label`, `framed`, `badge`), then "Saved".
   - `IconButton` already supports `badge` (`mobile/src/ui/components.tsx:221-269`).
   - DESIGN.md's header rule requires a label on every header action except `⋯`, and allows two.
   - The bell pushes `/activity`.
5. **Activity screen:**
   - Route `mobile/src/app/(app)/(home)/activity.tsx`, titled "Activity". The screen lives in `mobile/src/features/home/`.
   - Infinite list with `useSkipEmptyPages`.
   - Marks seen under `shouldMarkFeedSeen`: focused, a row at least 50% visible, loaded, not failed, not fetching, not already sent.
   - `useFollowBack` moves here from `HomeScreen`.
   - Empty state: "Nothing new yet. New followers and plays of your games show up here."
6. **`ActivityRow`:**
   - Layout: avatar (a trophy tile for a completion), one sentence, the time under it, and one trailing action. A "new" dot shows when `isNewDigestItem`.
   - Follow: "charlie followed you".
     - Action is "Follow back" as a secondary `Button`, using its `loading` state while the request runs.
     - When the viewer already follows them, the action is "Following" in grey text.
   - Participation: `participationLead` + "played your quiz" / "ranked your tier list" / "voted in your tournament" + the game name in bold. Action "View results →" / "View rankings →" / "View tournament →".
   - Completion: "A tournament you joined has finished: <tournament name>". Action "View final bracket →".
   - Tapping the row body opens `digestRoute(item)`. The row body is at least 44pt tall.
   - The accessibility label is the sentence plus the time.
7. **Home posts (`HomeFeedRow`, `FeedPreview`, `HomeScreen`):**
   - Home renders one section, "Your reading circle", with "Find readers →" bold. `homeFeedSections` goes away if nothing else uses it.
   - The heading, text links, bookmark and reaction buttons lose their 44pt `minHeight` and keep a 44pt touch area through `hitSlop`. Vertical padding tightens.
   - Target heights, measured on the emulator (today about 265pt):
     - about 180pt for a post whose action is a link;
     - about 205pt for a reading post, since the "Want to read" `Button` stays 44pt.
   - Every dense post's preview sits in a column at least `SLOT_WIDTH` wide, content left-aligned. A tier-list vote's 120pt ranking keeps its own width.
   - The no-cover icon fallback becomes a 48×72 surface tile, the size of a book cover.
   - "Want to read" becomes a secondary `Button`. "Open in your shelf" opens a screen, so it becomes a "→" link.
   - A like or comment count of 0 shows the icon only. Accessibility labels keep their current wording.
   - All verbs use `colors.textDim`.
   - No "new" dots on posts.
   - The Home section of `mobile/README.md` describes the bell and Activity instead of "Around your shelf".
8. **Order check:** no code change.
   - In this worktree's fixture database (`backend/data/dev/`, read 2026-10-16), the play of the dev quiz, alice's finished book and the follows were all written within 30 ms, in the order the server returned them: play newest.
   - So the server order is right, and the 2-minute gap between the captured labels can't come from the data.
   - The device pass checks that time labels never get younger down a list. If they do, diagnose it then, with a failing test first.

## Testing

- **Backend:**
  - A follower plays the viewer's quiz:
    - with all kinds: one `participation` item and no `vote` item;
    - with circle kinds only: no item at all;
    - with no `kinds` (legacy): the `vote` item.
  - A follower plays someone else's quiz: the `vote` item is still returned.
  - A follower ranks the viewer's promoted tier list: the `vote` item is still returned.
- **Shared:**
  - `plural` at 0, 1 and 2.
  - `contentDetail` with counts of 1, for a quiz and for a tier list.
  - `dashboardQuery` with and without `kinds`. The existing string assertion in `dashboard.test.ts:100-104` moves.
- **Mobile model tests:**
  - The Activity row's sentence and action for every personal kind, including the "Following" state.
  - The zero-count rule, without hiding the loading "…".
- **Device pass** with `device-checker`:
  - Home: header bell with badge, one section, post height, aligned titles, "Want to read" button.
  - Activity: rows, "Follow back", and the badge clearing after the screen is seen.
  - The empty state isn't device-checked: the fixture always has follows and a play.
  - Both: time labels never get younger down the list.
  - Both again at the largest system font size.

## Non-goals

- **Web UI changes.** Web keeps its combined list and its own seen trigger.
- **A second seen timestamp,** and "new" dots on circle posts.
- **A quiz score in Activity.** It needs a per-game score aggregate in `sqliteQuizzesRepository.ts:60-71`.
- **`BookCover`'s initial-letter fallback.** It is app-wide (Arena, Search) and already a rectangle, unlike round avatars.
- **Push notifications.** They are out of scope per `docs/superpowers/specs/2026-09-30-social-loop-design.md:567`.
- **The grey gear in the captures.** It is Expo Go's dev-tools button, not app UI.
- **Fixture avatars** that all read "F".
