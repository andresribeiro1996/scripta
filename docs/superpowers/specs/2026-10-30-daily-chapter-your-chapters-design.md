# Daily Chapter: Your chapters

Date: 2026-10-30. Scope: phone app, shared package, backend. The website is out of scope for this round: it keeps its current "Your chapters" block on `/daily`.

Mockups: `2026-10-30-daily-chapter-your-chapters-mockups/screens.html` (stats page, a past day, share sheet). Numbers in the mockups are made up; only the layout is agreed.

## Why

The Daily Chapter (five-question book quiz, one edition a day) already saves every player's results on the server and shows a plain "Your chapters" block under today's game: count played, day streak, per-theme counts and a list of past dates with scores (`mobile/src/features/dailyChapter/daily-chapter-screen.tsx:34`). The user wants a proper home for their own run: how their score moves over time, reachable from Home once they've played, and shareable. The app is moving towards being social (see the 2026-09-30 social direction), so the user also wants to see how people they follow did on the same chapter, wants the stats on public profiles, and wants Daily Chapter in the monthly Top Shelf recap.

## Goals

1. **Home header icon.** On the mobile Home screen, a new icon in the header (next to the bell and the bookmark, `mobile/src/features/home/HomeScreen.tsx:52`) opens the Your chapters screen. It appears only once the signed-in user has at least one Daily Chapter result. After that it stays, including on days they haven't played yet (Claude's call; the request said "if the user already played").
2. **Your chapters screen** (mockup screen 1), top to bottom:
   - Three headline numbers: current day streak, average score out of 5, perfect editions (5/5).
   - Personal bests: longest day streak ever, most perfect editions in a row, total questions right out of total answered.
   - A month calendar, Monday-first, each day shaded by that day's score (darker = higher). Swipe or arrows go back to earlier months, as far as the first month played. Tapping a played day opens that day.
   - By theme: one bar per theme played, percent correct, with the strongest and weakest labelled. The per-theme numbers already exist (`DailyChapterThemeStats`).
   - Past chapters: one row per played edition, newest first, with date, title and the five right/wrong squares. Tapping a row opens that day.
   - A share action in the header and a "Share my chapters" button at the bottom.
3. **A past day** (mockup screen 2), opened from a calendar day or a list row:
   - The score and the five squares.
   - Your answers: each question's prompt, what you picked, whether it was right, and for wrong answers the right answer and the explanation. Every saved result already carries these (`DailyChapterResult.answers`), so this needs no new endpoint.
   - **People you follow:** the people you follow who have a public profile and played that edition, plus you, sorted by score, highest first. Each shows avatar, username, the five squares and the score. It never shows which options they picked.
   - Only days you played can be opened. Past editions can't be replayed, and missed days aren't viewable.
4. **Share** (mockup screen 3), using the existing image share sheet (`mobile/src/features/sharing/ContentShareSheet.tsx`, already used by Top Shelf recaps, murals and tier lists):
   - **Image:** a poster of the month currently shown on the calendar, with the shaded grid, streak, average, and best theme. It has no dates, titles, questions or answers, so it can't spoil anything. It can be shared or saved to photos.
   - **Text:** the same month as an emoji line for group chats, plus the streak, the average and the `/daily` link. This extends today's single-day share line (`dailyChapterShare`, `packages/shared/src/quizzes/dailyChapter.ts:148`).
5. **Public profile stats.** A user's profile shows a compact Daily Chapter section: headline numbers, the current month's grid and best theme. It uses the same no-spoiler rule as the poster: no titles, questions or answers. It is shown on your own profile always, and on someone else's only if their profile is public. It lives in a "Daily" tab on both profile screens (Claude's call, made at planning: the own-profile screen has no shared header to hold it). With no results, or when the profile is private, the tab shows a short empty note instead.
6. **Community card in the Top Shelf recap.** The monthly recap (`/recap/[month]`, same for every viewer) gains a Daily Chapter card about everyone's month, for example:
   - how many people played;
   - the hardest chapter of the month (lowest average);
   - the most-missed question, with its right answer;
   - the top public players by perfect editions.

   Editions belong to a month by their date (`YYYY-MM` prefix of the edition's UTC date).

## Who can see what

The rule is the user's: **if the profile is public, everyone can see that person's Daily Chapter scores.**

- "Public" is the existing published-profile flag that already gates murals and votes (`backend/src/modules/community/domain/visibility.ts`: `published`). It is not the per-feed settings (`votes`, `reading`, …) and not follows.
- A private profile's scores are visible to nobody but its owner. Followers get no exception (Claude's call; the user didn't say otherwise).
- Other people only ever see squares and scores, never the options someone picked.
- Guests (signed-out players) never appear in anyone's list, on any profile, or by name in the recap. Their plays may count towards anonymous recap totals such as "how many people played" and averages (Claude's call).
- The "People you follow" list for an edition is only returned once the viewer has played that edition. That way it can't hint at today's answers before you play.

## Non-goals

- The website. It keeps its current block; parity is a later round.
- Replaying past editions, or opening days you missed.
- A global leaderboard or ranking outside the recap card.
- Notifications, badges or achievements.
- A personal "your month" card inside the recap. The recap stays the same for every viewer, and your own month lives in the share poster.

## Anti-goals

- Anyone seeing which options another person chose, on any screen.
- A private profile's scores showing up anywhere outside its owner's own screens: lists, profile, recap.
- The share poster or profile section revealing titles, questions or answers.
- An installed older app showing a broken or blank recap card (see Constraints).

## Constraints and facts the builder needs

- **Storage.** Plays reuse the generic quiz tables: `quiz_plays` (`quiz_id` = edition id, `voter_user_id` = user id or `daily-guest:<guestId>`) and `quiz_play_answers` with a `correct` flag (`backend/src/modules/quizzes/adapters/sqlite/schema.sql:24-48`). The unique index `(quiz_id, voter_user_id)` serves "plays of edition X by these users". No index leads with `voter_user_id`, so the builder measures the per-user reads used for public profiles before deciding whether one is needed.
- **Guest claim.** `POST /daily-chapter/history` with a token and a `guestId` moves that guest's rows to the user (`dailyChapterService.ts:31`). The Home icon's history query should send the stored guest id (AsyncStorage `daily-chapter:guest`), as the Daily screen does, so results played before signing in count.
- **Dates.** Edition days are UTC dates and close at 00:00 UTC (`dailyChapterService.ts:15,25`). The streak, calendar and month grouping all use edition dates. The recap freezes on Lisbon month boundaries (`backend/src/modules/community/topShelf.ts`). In summer that is an hour before the month's last edition closes, so the Daily Chapter card must not be frozen at that moment with plays missing.
- **Module boundaries.** Quizzes doesn't import community. Cross-module data is injected in `backend/src/app.ts`, as `readerVisibility` is for works (`app.ts:229`). Quizzes needs two things it can't get today: whether a user is published, and whom a viewer follows. `CommunityPublicApi` exposes `readerVisibility` but nothing that lists followees (`community/service.ts:611`).
- **Old installs.** Phones stay on old builds for weeks (`backend/AGENTS.md`). An unknown recap card kind renders as an empty card on today's app (`recapModel.ts` switches have no default; `RecapCard.tsx`). So the new card kind must be opt-in: the client asks for it with a parameter, the way the dashboard's `kinds` works. Old installs simply don't get it. New endpoints and fields are additive.
- **Shared logic.** Personal bests, month grids, emoji text and the like go in `@scripta/shared` next to `dailyChapterStats`, with tests, not in the mobile screen.
- **Icons.** `mobile/src/ui/icon.tsx` has no chart or calendar glyph; add one `{ios, android}` pair.
- **Streaks skip days with no edition** (Claude's call). A date with no published edition neither extends nor breaks a day streak. Only a published edition you didn't play breaks it. The same rule applies to "perfect editions in a row", counted over consecutive published editions. Today `dailyChapterStats` walks calendar dates (`dailyChapter.ts:130-131`), so a gap in the schedule would end everyone's streak. Change it there, so the headline streak, the personal bests, the website and older app builds all agree: the streak is computed on the server, so older builds get the corrected number too.
- **Community needs quizzes data.** The profile section and the recap card read Daily Chapter plays from the community side. Wire that the same way, with an injected dependency in `app.ts`, or serve the profile section from a quizzes endpoint that receives the published check by injection. That choice is the builder's.
- **Daily screen.** Today's existing "Your chapters" block on the Daily screen: signed-in users get a link to the new screen in its place. Signed-out players keep the existing block, because they can't reach Home (Claude's call).

## Left to the builder

- Endpoint shapes and names, and whether the stats come from the existing history route or a new one.
- Whether the recap's Daily Chapter part is frozen with the month (after the last edition closes) or computed at read time from closed editions. Claude leans towards read time: closed editions' plays don't change, it avoids the freeze-timing gap, and old frozen months need no migration.
- Exact recap card contents and copy, and what to show for a month with almost no plays (hiding the card is fine).
- Where the profile section sits in `ProfileScreen.tsx` / `MyShelfScreen.tsx` (a section in an existing tab, or a new tab).
- How calendar days are drawn when no edition was published versus when you missed one. They must look different.
- The emoji mapping for scores in the text share.
- The icon glyph.
