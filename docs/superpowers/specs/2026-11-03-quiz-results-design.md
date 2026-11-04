# Quiz results: Your answers and Leaderboard

Agreed with the user on 2026-11-03 from two rounds of mockups. Applies to mobile (`QuizPlayScreen`) and web (`QuizResults`, `PlayQuizPage`).

## Your answers

- Each row shows the question for quote, blurb and character questions. Quote and blurb prompts sit in curly quotes, character prompts are the plain names. Cover questions show no text because the thumbnail is the question. A title-to-cover question's prompt is already the row title.
- The prompt is clamped to two lines while collapsed and shown in full when expanded. A row that can't expand shows it in full, so it's always readable.
- A wrong text answer reads "✗ You picked Dune" on the collapsed row. A wrong cover answer stays "✗ Incorrect", because a picked cover has no title.
- Misses come first, otherwise in question order. Each row keeps its original question number.
- The row keeps its chevron and expand-on-tap. Expanding shows the side-by-side comparison when the pick was a cover, and an "Open book" link when the question has a work.
- A row with nothing behind it (a text answer with no work) has no chevron and doesn't expand. A legacy row with no answers keeps today's "answer unavailable" body.
- Desktop web keeps its always-open comparisons and gains the prompt, the order and the link.

## Leaderboard

- Every row has an avatar, using the existing `AuthorAvatar` on each client. Guests get the initial of their label.
- The viewer's own row is highlighted with the accent-soft background. There is no visible "you" text; assistive tech still hears "You". Its avatar has a thin accent ring, so an initial-only avatar doesn't vanish into the highlight.
- First place's rank is in the accent colour, as on Top Shelf.
- The hero shows the viewer's rank under the score: "#3 of 6 players" (pt-PT "3.º de 6 jogadores"). No rank when the viewer isn't on the board or is alone on it.
- A viewer alone on the board sees "Just you so far. Send the link to a friend." under their row.
- Unnamed guests no longer read "Guest" twice. The caption only appears under a typed name. This also fixes the owner's results table.
- Times of a minute or more read `2:23`. Under a minute they keep the decimal (`16.8s`), because ranks can turn on it.
- Mobile gets pull-to-refresh.

## Challenge

Sharing carries the score: "I got 7/10 on Classics. Can you beat me? <link>". Mobile's share sheet and web's copy button both send it. Web's visible link field stays the bare URL.

## Timing

- The clock starts when the first question is on screen and stops at the last answer tap. Loading and typing a name no longer count.
- The client keeps time within the server's limits, 0 to one hour. Today a player who leaves the screen open past an hour gets a rejected submission.
- Mobile shows the same running time as web, in the question caption.
- Old plays are left as they are, since time only breaks ties and they can't be recalculated.
- Signed-in players with a username aren't asked for a leaderboard name, because the backend ignores it.

## Data

- `GET /quizzes/voting/:code/results` accepts an optional `?playId=` and an optional token. Each play gains `avatarUrl` and `isYou`.
- A token wins over `playId`, as in `playerFor`. An anonymous match needs `voter_user_id IS NULL` and the matching id.
- It's a query parameter rather than the `/play/:playId` two-route shape so a new client still works against an old backend during a deploy, which would 404 on a new path.
- Other players' `playId` stays stripped.
- The route sends `Cache-Control: no-store`, because the response now differs per viewer. Nothing in the repo says whether `api.` has Cloudflare cache rules, and this makes it safe either way.
- Post-play `answers` gain `workId`, which is only returned once the player has finished.

## Decisions

- **Private players' avatars show on the board.** They come from the same lookup as the username, which has no privacy gate. A stranger opening a private profile already gets username and avatar (`docs/superpowers/specs/2026-10-07-author-visibility-design.md:40`), and #376 already names these players on quiz results, so this exposes nothing new.
- **Rank copy avoids ordinals in English.** The mockup's "3rd" would need an ordinal formatter that doesn't exist; "#3" doesn't.
- **Own row isn't pinned while scrolling.** The hero's rank already answers "where am I", and pinning means viewport measurement on two clients.
- **Names don't link to profiles.** Left out until the user decides, since it needs a further check on private players.

## Out of scope

Paging the leaderboard, a server-side timer, and changing how plays are ordered.
