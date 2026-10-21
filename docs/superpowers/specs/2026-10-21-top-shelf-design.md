# Top Shelf — design

## Why

The Games tab's title bar holds only its name now that "New" moved to a floating button. The user wants that space to lead somewhere worth visiting: a place that celebrates what is happening across Scripta's games — which games people are engaging with, and which books keep winning, appearing and ranking well — including per genre. It fits the 2026-09-30 social direction (make the app feel less isolating) by showing the community's activity back to everyone.

## What it is

**Top Shelf**, a hall of fame for everyone on Scripta (the user chose the name over "Hall of fame"), opened from a trophy icon at the right of the Games title bar. Two screens in step 1, a third in step 2.

Mockups (brainstorm companion, kept locally under `.superpowers/brainstorm/49045-1792581822/content/`): `hall-of-fame-bottom-controls.html` is the agreed layout; `hall-of-fame-combined.html` shows the full flow including the step-2 recap.

### Main screen — "Top Shelf"

Top to bottom:

1. **Podium.** The period's top three books, champion in the middle with its title. Overall rank is points across the book records (see Scoring).
2. **Records strip.** A horizontal row of cards, one per book record, each showing the record's name, its leader and the leader's number ("👑 Most crowned · Dune · 5 titles"). Tapping a card opens that record's leaderboard.
3. **Champions by genre.** A horizontal row of genres, each showing its top book (by the same podium points within that genre). "›" or tapping a genre opens that genre's leaderboard.
4. **Hottest games.** The top games by interactions, as game rows with their counts shown separately (♥ likes · votes · 💬 comments). "›" opens the full games leaderboard. Tapping a game opens it, as rows do elsewhere.

### Leaderboard screen

One screen used for every book record, for a genre's champions, and for hottest games: a ranked top 10, each row with rank, cover, title, a bar proportional to the leader, and the number. Tapping a book opens its book page (which already has per-book stats); tapping a game opens the game.

### Controls — at the bottom

Both screens have a bottom bar in the position Library and Search keep their search dock, hiding while scrolling and returning when scrolling stops, as the dock does:

- **This month / All time** switch, filling most of the row.
- **Genre** button ("All genres ▾"), opening a menu like Library's sort menu, listing "All genres" plus genres that have at least one entry in the current period. Active state looks like the dock's active filter button.

The user explicitly asked for these at the bottom, not the top. Period and genre carry from the main screen into a leaderboard opened from it, and can be changed there. On the main screen a chosen genre filters the podium and the records strip; the Champions by genre row is hidden while a genre is chosen (it would show only itself); hottest games are not filtered by genre.

### Records (step 1)

| Record | Ranks books by | Period meaning ("This month") |
|---|---|---|
| 👑 Most crowned | tournament titles (winner of a completed tournament's final) | tournaments completed this month |
| 📊 Most tiered | published tier lists the book appears in | tier lists published this month |
| ⭐ Highest tier | best average tier placement, minimum 3 lists | placements on ballots cast this month |
| ❓ Most quizzed | published quizzes the book appears in | quizzes published this month |
| 🌱 Rising star | appearances this period, among books whose first-ever appearance in any public game (vote bar or not) is this period | only shown under "This month"; hidden under "All time" |

"Most tiered", "Most crowned" and "Most quizzed" were the user's; "Highest tier" and "Rising star" are additions the user accepted.

### Qualifying games — the vote bar

A game only feeds the book records, the podium and the genre champions once at least **5 distinct people** have voted on it: 5 ballots on a tier list, 5 plays on a quiz, 5 different voters on a tournament (counting voters, not duel votes — one person voting through a 16-book tournament casts 15 votes). The game's owner never counts toward its own 5; anonymous voters do (a tournament voter is a signed-in user or a voter token; each anonymous quiz play or tier list ballot is one person). The user chose 5 to start and wants to raise it as the community grows, so it is one named constant, used in one place. It stops one enthusiastic person from topping a board with games nobody else touched. Hottest games are not filtered by it — their ranking is already by engagement. In "This month", the bar is on the game's all-time voters, not voters this month (my call: a game qualifies once, it does not drop out on the 1st).

### Scoring (podium and genre champions)

My call, tunable by the builder if the results look wrong on real data: a tournament title is worth 3 points; each appearance in a tournament, a tier list or a quiz is worth 1. Ties break by titles, then by the most recent appearance, then by work id so the order is stable. A work counts at most once per game: two editions of the same canonical work in one tier list are one appearance.

### Hottest games

Ranked by likes + votes + comments added together (my call), each shown separately on the row. Votes means: tier list ballots, tournament duel votes, quiz plays — anonymous ones included, since they are real engagement (my call). A ballot counts once, at the time it was first cast; re-casting does not move it. Under "This month", only interactions made this month count, on any public game, all three game types. If likes or comments carry no timestamp of their own, say so rather than bucketing them by the game's publish time. Genre does not filter games (a game spans many books); the genre button is disabled or hidden for the hottest-games leaderboard — builder's call which.

### Period

"This month" is the calendar month in Europe/Lisbon, computed on the server, resetting on the 1st (my call: it matches "Book of the month" and the step-2 "October recap", and one boundary for everyone keeps the results identical and cacheable; the community is Portugal-based). "All time" is everything.

Timestamps per record (my calls, from what the schemas hold):

- Published-this-month for tier lists and quizzes: the game's publish event time in community (one per game). Later edits never move a game to another month.
- Tournament completed this month: the `settled_at` of its final duel.
- Rising star's "first-ever appearance": the earliest publish time among public games the work appears in, computed from the live game tables, not the event log.

### Genre

A book counts in every genre its work has. Books with no known genre count in "All genres" but in no genre view. No "Unknown" genre is shown.

### What counts — visibility

Only content a stranger could already see, computed from the live game tables at read time — so a game that is deleted, unpublished, or whose owner unpublishes their profile simply stops counting, in every period including All time:

- Published games only — the same gates the existing per-book stats and Discover use (a tier list or quiz is public once published; a tournament once it leaves seeding, so active tournaments count for appearances and votes, while Most crowned needs a completed one). Drafts never count.
- A game counts only if Discover would list it — its owner resolves to a public reader profile, or it is a promoted tier list shown as "Original creator unavailable". Games Discover hides do not count, and neither do their likes/comments. (Checked against the code: Discover's rule is profile resolution, not the feed's `profiles.published` flag; Top Shelf sits beside Browse, so it follows Browse.)
- Per-book placement numbers follow the existing book-stats rules (e.g. which ballots count for tier placements), so a book's hall-of-fame numbers never contradict its own stats page. Merged works count as their canonical work.

## Step 2 — recap cards

A "▶ Play October recap" button on the podium opens full-screen cards, one per record for the month, tapped through like stories, each shareable. Uses the same numbers as step 1. Not built in step 1; the podium layout should leave room for the button below the champion's title.

## Goals

- Someone opening Games can see in seconds what is hot and which books are winning, this month or ever, overall or in their favourite genre.
- Every number uses the same definitions and words as the per-book stats page (titles, tier bands). Top Shelf counts only games past the vote bar, so a book's Top Shelf number can be lower than its own page's — that is expected, not a bug.
- Same look and controls as the rest of the app (bottom bar, Library-style menu, existing game rows and book covers).

## Non-goals

- Web frontend (mobile only in step 1 — my call; the Games header change it builds on is mobile).
- Personal or friends-only stats; this is everyone's Top Shelf.
- "Most answered correctly in quizzes" — answers are not stored per book today. Later.
- Per-user leaderboards (top creators, top voters).
- Notifications or badges for record holders.

## Anti-goals

- Leaking anything private: a draft, a seeding tournament, or a game by someone whose profile is unpublished must never influence a number or appear.
- One person or one vote deciding a record — that is what the vote bar and the "Highest tier" minimum of 3 qualifying lists are for. Any further minimum should come back to the user rather than being invented.
- A slow screen. The catalog is ~233k books; rankings must be computed over the (much smaller) game tables and only then joined to covers and genres for the shown works, never the other way round.

## Constraints and facts from the codebase

- Each module has its own SQLite file (tier lists, arena, quizzes, community, books); there is no cross-module SQL join. Aggregation happens across module APIs in the backend, as the per-book stats endpoint already does.
- Games reference books by work id. Tournament titles come from completed tournaments' final duels; tier list appearances from the per-list work index; quiz appearances from the per-quiz work index. Likes and comments hang off each game's publish event in community.
- Genres live on catalog editions/works and can be batch-resolved for a set of work ids.
- No leaderboard or caching exists today. The per-book stats endpoint is per work and not reusable for ranking (it would be one query per book).

## Left to the builder

- API shape, endpoints and where the aggregation lives; whether to cache and for how long, measured against prod-sized data.
- Exact timestamps used for each record's "this month" (the table above states the intent; if a needed timestamp does not exist, say so before inventing one).
- Empty and thin states (early in a month, or a genre with one entry): sensible copy, never a broken podium.
- Icon choice for the Games header trophy, within the existing icon set.
- How the leaderboard handles ties visually.
- Whether the hottest-games leaderboard hides or disables the genre button.
