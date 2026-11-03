# You → Daily: a calendar that always shows

Mockup: [`2026-11-03-daily-tab-calendar/full-design.html`](2026-11-03-daily-tab-calendar/full-design.html). It uses the real chapters from Oct 30 to Nov 3.

## Why

The Daily sub-tab on the mobile You tab is thin. Someone who has never played sees an empty state and no calendar. Someone who has played sees stat tiles and a month calendar with no day numbers, no tapping and no way to change month. The richer view exists on "Your chapters", which is a separate screen the user has to know about.

The user wants this tab to be where they look at their Daily Chapter: every chapter visible whether they played it or not, and any past chapter readable.

## Goals

On You → Daily, for the signed-in owner:

- The calendar always shows, including for someone who has never played.
- A Week / Month switch, with arrows to move between periods.
- Day numbers, and tappable days.
- Tapping a missed day shows that chapter's questions and answers.
- A "Past chapters" list that shows only the period the calendar is showing. There is no endless list and no search.

## Non-goals

- The website. It keeps its current text list and gets no calendar.
- Playing missed chapters later. They stay closed, as the backend enforces today.
- Searching chapters by title or book.
- Book covers in the list. Chapters don't carry covers, and this was considered and dropped.
- Other people's profiles (see below).
- Guests. The You tab is signed-in only, and the guest list on the Daily screen doesn't change.

## Anti-goals

- Reading a missed chapter's answers must never change a streak, a stat or a theme rate.
- Today's chapter and future chapters must never expose answers to someone who hasn't played them.

## The screen

Top to bottom:

1. **Stat tiles** (streak, average, perfect), all-time as they are now, not tied to the period. They only render once the person has played at least one chapter.
2. **Week / Month switch.** It opens on Week. The pick is remembered on the device.
3. **Period header** with ‹ › arrows.
   - Week is the 7 days ending today. Arrows move 7 days at a time. Later windows keep that alignment, so the window is always "7 days ending today minus 7n".
   - Month is a calendar month.
   - › stops at the current period. ‹ stops at the period containing the first published chapter.
4. **Calendar.** Month is Monday-first, as now. Week is 7 cells in date order, oldest on the left and today last, each labelled with its weekday.
   - Played: filled, tinted by score. Tapping opens that day's page.
   - Missed: outlined. Tapping opens that day's page.
   - Today: ringed. If unplayed, tapping opens `/daily`. If played, it looks like any played day.
   - No chapter (before launch, the future, or a gap in the schedule): plain, not tappable.
   - Week cells also show a small caption under the number: "5/5", "Missed" or "Play". Month cells show only the number.
5. **"Best at" line**, kept where there is a best theme.
6. **Past chapters**: every played or missed chapter in the visible period, newest first. Today appears only once played. Each row has two lines: the title, then "Mon, Nov 2 · Memoirs" (weekday, date, theme). On the right, played rows show score squares and "4/5", and missed rows show "Missed". All rows open the day page. A period with no chapters shows a short line saying so.

**Play button.** "Play today's chapter" is fixed to the bottom of the screen and doesn't scroll with the page. It shows whenever there is a chapter today that the person hasn't played, whether or not they've played before, and is hidden otherwise. It sits above the tab bar, below the scrolling content, so it never covers a row. As it is part of the shared component, it also appears on "Your chapters".

**Missed** means any published chapter dated before today that the person didn't play, including those before their first play. This differs from the existing calendar logic, which only marks days from the first play on. The wider meaning applies only to the owner's view.

## The day page

`DailyChapterDayScreen` handles a missed chapter as well as a played one:

- The header is the same: date and title.
- A line says "You didn't play this chapter."
- Each question shows the prompt, the right answer and the explanation, using the same card as played days.
- "People you follow" appears as it does on played days.

If the page is opened on an id the person can't review, such as today's unplayed chapter through a deep link, it keeps the existing "You didn't play this chapter" empty state.

## "Your chapters"

It gets the same calendar and list, using one shared component, so the two screens can't drift apart. It keeps what the You tab doesn't have: longest streak and bests, theme bars, and share. The share poster stays a month poster. In Week view it uses the month of the visible week's last day.

Its current flat list of all results goes away, replaced by the list that follows the calendar. Its empty state goes too, since the calendar now always shows.

## Other people's profiles

No change. `DailyChapterProfileSection` with `own={false}` keeps the small calendar with no numbers and no tapping, and `GET /daily-chapter/players/:userId` keeps its response. Its `days` keep today's meaning through `dailyChapterMonth`, so visitors don't see days before that person's first play marked as missed. Today's outline already shows gaps since their first play, and that stays as it is. The owner's You tab stops using that route for this view.

## Backend

Every change is additive, because installed apps stay on phones for weeks.

- **`POST /daily-chapter/history`** gains a list of past published chapters with their id, date, title and theme, so missed rows can be drawn. Today's chapter is left out, since `editionDates` already says whether one exists. Existing fields don't change. The website ignores the new field.
- **New `GET /daily-chapter/:id/review`**, signed-in only, returns date, title, theme and each question's prompt, options, answer index, explanation, source and book, with no player data.
  - It answers only for a published chapter dated before today.
  - Today's chapter gets a 403 with `quizzes.dailyPlayFirst`, as `people` does.
  - Future, unpublished and unknown ids get a 404 with `quizzes.dailyNoEdition`.
- **`GET /daily-chapter/:id/people`** currently refuses anyone who hasn't played (`quizzes.dailyPlayFirst`). That guard protects today's chapter. It relaxes so a chapter dated before today doesn't need a play. Today's chapter keeps the guard, and future chapters still get a 404.

This changes who can see what, so the branch needs the `security-review` skill before merge. Tests must cover the review route refusing today and future chapters, and `people` still refusing today's unplayed chapter.

## Shared logic

New logic goes in `@scripta/shared`, next to `dailyChapterMonth`, and is unit tested there: the day status for a date range, the rows for a period, and the period bounds and arrow limits. The website may want these later, but this isn't built for it. `dailyChapterMonth` and `dailyChapterSummary` keep their current behaviour for the public profile and the poster.

All dates are the UTC days the backend already uses, and `history.today` is today. Row dates must be formatted as UTC, and tests set a west-of-UTC timezone, because the Mac and CI won't catch local-versus-UTC bugs otherwise.

## Copy

New strings go in both `en` and `pt-PT`. The wording in the mockup is a starting point, not final.

## Release

The backend must be live before the app update, since the new app needs the new history field. This is a JS-only change, so it goes over the air and needs no store build. Deploying stays with the user, per the usual runbook.

The launch editions end on 2026-11-12. If no new ones are scheduled, later days show as plain "no chapter" days. That is correct behaviour and separate from this work.

## Left to the builder

- Reusing the app's existing tab or segmented control for the switch, if one fits.
- Field and type names, and how the shared component is split.
- Loading and error states, following what these screens do now.
- Accessibility labels for calendar cells, following the existing `quizzes.outOfFive` pattern and adding labels for missed days and today.
