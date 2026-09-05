# Tier list voting — community tier lists decided by ballot

## Context

Tier lists today are a private, owner-scoped resource (`modules/tierlists`,
`/dashboard/arena/tierlist/:id`): the owner ranks books into tiers and
nobody else ever touches the document. The only way one reaches another
person is read-only, embedded in a shared mural.

This feature makes a tier list *playable*. The owner opens it for
voting; anyone with the link ranks the same pool of books themselves,
and every submission is a ballot. Aggregating the ballots decides each
book's tier — the crowd's version of the owner's list.

## Decisions locked in with the user

- **Anyone with the link can vote — no account.** Same trust model as
  `GET /murals/shared/:token`: an unguessable token, not a session check.
- **Opening voting DUPLICATES the tier list.** The votable thing is a
  separate "community" resource; the owner's original stays private and
  fully editable. This is the decision the rest of the design hangs on.
- **The community copy's structure is frozen** — its tiers and its pool
  never change. That is what makes ballots comparable.
- **Players start from a blank board**, full pool, same tiers. Votes stay
  independent, so the consensus means something.
- **Unranked = "no opinion"**, excluded from that book's aggregate rather
  than counted as bottom tier. Results therefore always show a per-book
  vote count.
- **The owner's ranking counts as one vote**, seeded as ballot #1 at
  duplication time.
- **Three aggregation views, switchable**: Average · Most-voted · Median.
- **Results are visible after you submit** (owner sees them any time).
- **Vocabulary is "voting"**: a tier list is *open for voting*, people
  *vote*, a submission is a *ballot*.

## Why duplication simplifies everything downstream

An earlier iteration kept one row and locked edits while shared. That
forced a `structureSignature(data)` invariant on every `PUT` — and since
the owner's placements live in the same `data` document as the
structure, the lock had to permit some `data` writes but not others.

Duplication removes the whole problem:

- The community copy **rejects `data` writes outright.** No signature, no
  partial-lock rule.
- Because the copy carries no owner placements, **every vote is a ballot
  row** — the owner's included. The histogram has no special case, and
  the public board endpoint has no placements it must remember to strip.
- The original is untouched, so "my ranking vs. the crowd's" is a
  comparison between two real resources.

`modules/tierlists` currently treats `data` as an opaque blob
(`domain/types.ts`). This feature needs it to understand the document at
exactly **two** points, both explicit and both documented in-module:
splitting structure from placements at duplication, and validating a
ballot's book keys and tier ids on submit. Nowhere else.

## Backend design

### Schema (`adapters/sqlite/schema.sql`)

`tierlists` gains two columns:

- `vote_token TEXT UNIQUE` — NULL means "not open for voting". SQLite
  treats multiple NULLs as distinct, so unopened rows never collide;
  same reasoning as `murals.share_token`.
- `source_tierlist_id TEXT` — NULL for an ordinary tier list, else the id
  of the original this was duplicated from. Lets the UI badge community
  copies, and lets the owner navigate original ↔ community version.

Two new tables:

```sql
CREATE TABLE IF NOT EXISTS tierlist_ballots (
  id          TEXT PRIMARY KEY,   -- the secret handle the voter's browser stores
  tierlist_id TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_tierlist_ballots_tierlist
  ON tierlist_ballots(tierlist_id);

CREATE TABLE IF NOT EXISTS tierlist_ballot_placements (
  ballot_id   TEXT NOT NULL REFERENCES tierlist_ballots(id) ON DELETE CASCADE,
  tierlist_id TEXT NOT NULL,
  book_key    TEXT NOT NULL,
  tier_id     TEXT NOT NULL,
  PRIMARY KEY (ballot_id, book_key)
);
CREATE INDEX IF NOT EXISTS idx_tierlist_placements_histogram
  ON tierlist_ballot_placements(tierlist_id, book_key, tier_id);
```

Placements are normalized rather than a JSON blob per ballot, for two
reasons: the histogram becomes one indexed `GROUP BY`, and **"no
opinion" needs no encoding at all** — an unranked book is the absence of
a row.

### The histogram

```sql
SELECT book_key, tier_id, COUNT(*) AS votes
FROM tierlist_ballot_placements
WHERE tierlist_id = ?
GROUP BY book_key, tier_id;
```

Covered by `idx_tierlist_placements_histogram`. The result is at most
`pool_size × tier_count` rows — **constant in the number of voters**. A
poll with 50 voters and one with 50,000 return the same payload. Average,
most-voted, median and spread are all derivable from this one structure,
which is why all three view modes cost one fetch and switch instantly.

If the `GROUP BY` ever becomes hot, the fix is a maintained counts table.
Not now — no evidence, and it adds transactional write-path complexity.

### Opening voting

`POST /tierlists/:id/open-voting` (authed, owner-scoped), in one
transaction:

1. Read the original's `data` — `{tiers, pool}`.
2. Insert a new `tierlists` row: same `owner_user_id`, name `"<original
   name> (community)"`, `source_tierlist_id` = original id, fresh
   `vote_token`,
   and `data` = **structure only** — every tier keeps its `id`, `label`
   and `color` but gets `bookKeys: []`, and `pool` becomes the full union
   of the original's pool and all its tiers' book keys.
3. Insert one ballot whose placements are the original's tier
   placements — the owner's vote.
4. Return the new tier list and its `voteToken`.

The original is not modified. Opening voting twice creates two
independent community copies; that is allowed on purpose — re-running a
vote later is legitimate.

### Service surface

- `openVoting(ownerUserId, id)` — as above; `undefined` if not found or
  not owned, matching the module's existing convention.
- `closeVoting(ownerUserId, id)` — clears `vote_token`. **Ballots are
  kept**, so results survive and voting can be reopened.
- `getResults(tierlistId)` — the histogram plus `ballotCount`.
- `getVotingBoard(token)` — the community copy resolved for public
  display.
- `submitBallot(token, placements)` / `updateBallot(token, ballotId,
  placements)` / `getBallot(token, ballotId)`.

Placement validation rejects (400) any `book_key` not in the copy's pool
or any `tier_id` not among its tiers, and any ballot longer than the pool.

### Routes

Authenticated, in the existing unthrottled scope:

- `POST /tierlists/:id/open-voting` → `201 {tierlist, voteToken}`
- `POST /tierlists/:id/close-voting` → `{tierlist}`
- `GET /tierlists/:id/results` → `{histogram, ballotCount}`

Public and unauthenticated, registered in a **new encapsulated scope with
a tight `@fastify/rate-limit`** — the same builder split
`modules/murals/plugin.ts` uses for `GET /murals/shared/:token`, and
precisely the split `modules/tierlists/plugin.ts`'s own comment says the
module doesn't have yet:

- `GET /tierlists/voting/:token` → the board: name, tiers, pool. Books
  resolved through `resolvePublicLibraryData` (library's public surface),
  the same redaction path the shared-mural route already uses for
  tier-list blocks.
- `POST /tierlists/voting/:token/ballot` `{placements}` → `201
  {ballotId, results}`
- `PUT /tierlists/voting/:token/ballot/:ballotId` `{placements}` →
  `{results}`
- `GET /tierlists/voting/:token/ballot/:ballotId` → `{placements,
  results}` — rehydrates a returning voter.

An unknown or closed token is a 404, treated identically to "no such
token" — a closed poll must not be distinguishable from a fake link.

## Frontend design

- **`lib/tierlistResults.ts`** — the pure core. `aggregate(histogram,
  mode)` → per book `{tierId, score, votes, spread}`. All three rules
  live here and are unit-tested against fixture histograms with no DB and
  no network.
  - *Average*: tiers score by index (first tier = 0); a book's score is
    the mean over ballots that ranked it, placed in the nearest tier.
    Also gives ordering within a tier.
  - *Most-voted*: the tier with the highest count; ties break toward the
    higher tier.
  - *Median*: the middle vote; an even split breaks toward the higher tier.
- **`components/tierlist/TierBoard.tsx`** — the ranking board, extracted
  from `TierListEditorPage` so the editor and the public voting page
  share one implementation. This is the one refactor the work justifies;
  no unrelated restructuring.
- **`api/tierlistVoting.ts` + `hooks/useTierlistVoting.ts`** — thin
  `apiFetch` wrappers per route, matching `api/tierlists.ts`'s shape.
- **Public `/vote/:token` page** — unauthenticated route alongside
  `SharedMuralPage`. Blank board → rank → submit → results. The ballot id
  goes to `localStorage` keyed by token, so a return visit rehydrates the
  ballot and allows editing it.
- **Results view** — segmented control (Average · Most-voted · Median),
  the control Arena already uses. Per-book vote count and spread are
  visible in every mode, since a book with one vote is not as settled as
  one with two hundred.
- **Owner UI** — "Open for voting" in the tier list editor, which
  navigates to the new community copy and surfaces its link and ballot
  count. Community copies are badged in the Arena tier lists tab and
  their structural controls are absent, with a line explaining that a
  community list is frozen and that the original remains editable.

## Known simplifications (stated, not hidden)

- **Ballot dedupe is a browser-stored id, and will be beaten.** Clearing
  storage lets someone vote again. The rate limit is the real defence.
  This is a vibe poll, not an election; one-person-one-vote requires
  accounts, which was explicitly declined.
- No voter names or per-ballot identity — ballots are anonymous and
  indistinguishable.
- Results don't live-update; they refresh on load and after submitting.
- No way to adopt the community result back into the original list.
- Mural `tierlist` blocks continue to render a tier list, not results.
- No scheduled close — the owner closes voting manually.
- Deleting the original does not delete its community copies; they are
  independent rows.

## Verification

- Backend: `cd backend && npm run typecheck && npm test`. New
  `service.test.ts` cases — open-voting duplicates without touching the
  original and seeds the owner's ballot; the copy rejects `data` writes;
  ballot submit and edit; unknown book key or tier id is rejected;
  histogram counts including the owner's ballot; unranked books produce
  no rows; closed and unknown tokens are indistinguishable 404s.
- Frontend: `cd frontend && npm run typecheck && npm run lint && npm run
  build`, plus `lib/tierlistResults.test.ts` covering mean, plurality,
  median, ties, single-vote and zero-vote books, and unranked exclusion.
- Manual: open voting on a list, vote from a private window, confirm the
  results gate, switch all three modes, edit the ballot on a return
  visit, close voting and confirm the link 404s while results survive.
