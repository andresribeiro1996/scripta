# Top Shelf recaps — design

## Why

Top Shelf (PR #327, spec `2026-10-21-top-shelf-design.md`) shows which books win and which games are hot, this month or all time. Its step 2 is the monthly recap: a story-style look back at a finished month that people share **outside Scripta as an invitation** (the user's main aim), and sometimes with friends already on it. The shared picture's job is to bring a stranger into a game: "Dune won October — rank it yourself."

## Who and when

Early in a month (say 2 November), someone plays "October recap": full-screen cards tapped through like stories. They share one or more cards as pictures (Instagram Stories, WhatsApp, Photos). A stranger who sees the picture scans its QR and lands on a game they can play straight away, without an account.

## What it is

### The cards, in order

1. **Summary** — "October on Scripta" with three numbers: games published, votes cast, books in play (definitions under Numbers). QR → the landing page.
2. **Book of the month** — the month's champion (Top Shelf podium #1, all genres).
3. **One card per book record that has a winner**, in Top Shelf's order: 👑 Most crowned, 📊 Most tiered, ⭐ Highest tier, ❓ Most quizzed, 🌱 Rising star.
4. **Hottest game** — the month's #1 game by likes + votes + comments: its cover collage, name, and "N interactions". QR → that game.

Each book card: record name ("👑 October's most crowned"), cover, title, author, and the number in Top Shelf's words ("5 titles", tier band "Top tier", "12 lists", "7 quizzes", "4 games", "9 pts"). Tapping the cover opens the book page; tapping the hottest game opens the game.

A card exists only when its record has a winner. **A single card is enough for a recap** (the user's call). A month where nothing has a winner (no summary-worthy activity and no records) has no recap at all — no button, no Home card, not listed in past recaps. My call: the summary card alone doesn't make a recap; at least one book record or a hottest game must exist. When a recap exists the summary card always opens it, so a month with only a hottest game is summary + hottest game, and a month with only one record is summary + that card.

### Look — style A, "gold story"

Agreed from the mockups (`.superpowers/brainstorm/19141-1792610554/content/recap-card-style.html`, option A): dark background with a gold glow behind the cover, gold record label, serif title, progress dots at the top, ✕ to close. The same look on every phone regardless of the viewer's theme. Colours are the card's own, not theme tokens (the one deliberate exception, like reader-card prints); text contrast still meets AA.

### The shared picture

Each card shares as a **9:16 picture** (story size) through the existing `ContentShareSheet` (`mobile/src/features/sharing/ContentShareSheet.tsx`). The captured picture is the card plus a bottom strip containing a QR code, a call to action and the Scripta mark — the strip is drawn **inside** the captured view (the sheet's own QR isn't part of the image). The sheet's link/QR uses the same URL as the strip.

Call to action on a book card (the user chose this framing: October is frozen, but the games are still open and a vote now counts toward next month):

- Link to an open game → **"Rank it yourself — it counts for November"** (wording per game kind is the builder's, e.g. "Play the quiz", "Vote in the bracket"; it must say the vote counts for the current month, never for the recap's month).
- No open game → **"See Dune on Scripta"**, QR → the book's public page.

Hottest game card: "Play it yourself" if it still accepts a stranger's vote, otherwise "See how it ended"; QR → the game either way.

### Which game a book card links to

The user agreed this rule: **the game that includes the book, currently accepts a stranger's vote, and had the most interactions (likes + votes + comments) in the recap's month.** If none, the book's public web page (`/work/:id`).

"Accepts a stranger's vote" (from the code): a tier list with voting open and anonymous access (not a promoted reference list); a quiz with play open; a tournament that is active. The game must also still be visible by Top Shelf's rule (owner resolves to a public profile, or promoted tier list). My call: the link is resolved **live** when the recap is read, not frozen — so a game that closes or goes private stops being linked and the card falls back, while the card's book and number stay frozen.

My call, for cost: the ranking of candidate games by the month's interactions is computed once at freeze time (the month is over, so it can't change) and stored with the card as an ordered list of game refs; at read time the first one that is still visible and still accepts a stranger's vote wins, else the book page. This is the agreed rule, evaluated cheaply.

Public URLs (existing web routes): tier list `/vote/:code`, quiz `/play/:code`, tournament `/arena/:id`, book `/work/:id`, landing `/` — built with the existing `publicContentUrl` / `contentTarget` helpers.

### Frozen months

A recap is **frozen when its month ends** (the user's call): computed once, stored, never recomputed, so a shared card always matches what's replayed later. Consequences, all accepted or my calls:

- Book cards keep their book and number even if a game behind them is later deleted or hidden (accepted by the user).
- The **hottest game card is dropped** from a frozen recap if that game is no longer visible when read (my call: a game's title and covers belong to its owner, and an owner who hides their profile shouldn't keep being promoted; a book's card has no such owner).
- Only the link (above) and the hottest-game visibility are checked live.

The month boundary is the calendar month in Europe/Lisbon, as Top Shelf. **Only activity inside the month counts** — a freeze that runs late (server down on the 1st) must not count November's first votes toward October. Today's Top Shelf facts are bounded below only (`since`); the recap needs an upper bound too (votes, placements' cast time, publish time, settlement, likes/comments).

The vote bar (5 distinct voters, owner excluded) is checked on the game's voters **up to the month's end** — lifetime voters, not only the month's, as Top Shelf's "This month" does, but bounded by the same upper bound (my call).

A game's month is its **publish time** — the publish event in community (`events`, or `events_history` once archived), falling back to the game's `createdAt` only when no event exists — exactly as Top Shelf's ranking does today. Likes and comments are read through both tables too, as `gameEngagement` already does.

Parity: the freeze runs Top Shelf's own ranking (`rankTopShelf`) with the month's start and end, so a recap equals what Top Shelf's "This month" showed at the month's end for every game still visible at freeze time. The plan should test that by construction (same function, bounded), not by a separate implementation.

When to freeze: shortly after the month ends, by the backend itself (the community module already runs a boot + daily timer for archiving; follow that pattern). My calls: when the recap table is empty, the run freezes only the most recent completed month (so a recap exists right away; older months are not backfilled). Otherwise it freezes every completed month after the newest stored one, oldest first — so downtime spanning several month ends fills every gap. A month with nothing to show is stored as empty (so it isn't recomputed) and is never listed.

### Numbers on the summary card (my calls)

Over visible games, in the month:

- **Games published** — tier lists, quizzes and tournaments whose publish time is in the month.
- **Votes cast** — tier list ballots, tournament duel votes and quiz plays cast in the month (owner's own excluded, anonymous included — the same count Top Shelf's hottest games uses).
- **Books in play** — distinct canonical works appearing in games published in the month.

No vote bar on the summary (it describes activity, not records).

### Where people find it

- **Top Shelf**: a "▶ Play October recap" button for the latest recap, in the space Top Shelf left below the podium champion's title; shown under both This month and All time. My call: hidden when the latest completed month has no recap.
- **Past recaps**: a row at the bottom of Top Shelf listing older months, newest first; tapping one plays it.
- **Home**: an announcement card at the top of the Home feed during the **first 7 days** of the month, with ✕ to dismiss; tapping it plays the recap. My calls: 7 days, dismissal stored on the device (AsyncStorage, like the arena voter token) per month, rendered as a header on `HomeScreen`, not a new dashboard digest kind.

Recaps are the same for everyone: all genres, no personal stats, readable signed out.

## Goals

- In early November, someone can play October's recap in under a minute and share any card as a picture that makes a stranger want to scan it.
- The stranger lands on something they can do without an account.
- A recap never changes after its month ends, apart from the live link and the hottest-game visibility check.
- The numbers use Top Shelf's definitions and words, so a recap never contradicts what Top Shelf showed for that month at its end.

## Non-goals

- Video export of the whole recap (the share sheet supports it; later).
- A web page for recaps (cards are shared as pictures; their QR leads to existing web pages).
- Per-genre recaps, personal ("your October") recaps, notifications/push.
- Backfilling months before the feature ships, beyond the most recent one.
- Changing Top Shelf's own screens beyond the button and the past-recaps row.

## Anti-goals

- A shared card whose QR leads to a dead end: a closed game, a members-only list a stranger can't vote on, or a private game.
- A call to action that implies voting now changes the recap's month.
- Leaking anything Top Shelf wouldn't show: drafts, seeding tournaments, hidden games — at freeze time and, for the hottest game, at read time.
- A recap that changes after being shared.

## Constraints and facts from the codebase

- Store frozen recaps in the community module's SQLite DB: a new table in `adapters/sqlite/schema.sql` (re-run at boot with `CREATE TABLE IF NOT EXISTS`).
- `topShelfFacts(since)` in tierlists/arena/quizzes, `gameEngagement(refs, since)` and `rankTopShelf` take only a lower bound; the month freeze needs an upper bound threaded through.
- `ContentShareSheet` captures its `children` view; no caller renders a 9:16 picture yet. `snapshotSize` keeps the aspect ratio, max 1200 px wide.
- Mobile tier list summaries don't carry vote access (anonymous vs members); the server-side link resolution can read it from the tier lists module instead.
- New public routes go in Top Shelf's existing rate-limited public scope; responses are viewer-independent. API changes stay additive (installed apps can't update; OTAs are blocked until a store build exists for the current runtime).
- Mobile only, like Top Shelf.
- New response types are new shared types; no existing shared type or route changes shape.

## Left to the builder

- API shape (e.g. list of recap months + one recap by month), storage format, timer cadence.
- Exact copy per game kind for the call to action, within the framing above.
- Card animation and tap areas (tap right/left for next/previous is fine), story progress timing (manual taps only is fine).
- Hottest-game cover collage layout (reuse what game rows/covers already render).
- Whether the recap screen preloads covers before showing a card.
