# Tier list voting — community tier lists decided by ballot

## Context

Tier lists today are a private, owner-scoped resource (`modules/tierlists`,
`/dashboard/arena/tierlist/:id`): the owner ranks books into tiers and
nobody else ever touches the document. The only way one reaches another
person is read-only, embedded in a shared mural.

This feature makes a tier list *votable*. The owner opens it for voting;
other people rank the same pool of books themselves, and every submission
is a ballot. Aggregating the ballots decides each book's tier — the
crowd's version of the owner's list.

## Decisions locked in with the user

- **Opening voting DUPLICATES the tier list.** The votable thing is a
  separate "community" resource with its own public identity; the owner's
  original stays private and fully editable. This is the decision the
  rest of the design hangs on.
- **The community copy's structure is frozen** — its tiers and its pool
  never change. That is what makes ballots comparable.
- **Voting access is per-poll and switchable**: `anonymous` (anyone with
  the link) or `members` (signed-in accounts only). The owner can change
  it while voting is open; ballots already cast are kept when tightening.
- **The public identity is a short code**, e.g. `/vote/k7m2x9qp` — short
  enough to say out loud, and **stable for the life of the resource**.
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

## Identity, access, and dedupe

Three separate concerns that must not be conflated:

| Concern | Mechanism |
|---|---|
| **Addressing** — how the poll is named publicly | `vote_code`, a short random code, permanent |
| **Authorization** — who may cast a ballot | `vote_access` = `anonymous` \| `members` |
| **Dedupe** — what stops one person voting twice | `voter_user_id` when signed in; browser-stored ballot id otherwise |

`vote_code` is an identity, not a secret. It is unguessable enough
(8 chars over a 32-symbol alphabet ≈ 10¹² combinations, behind a rate
limit) that a poll isn't casually discoverable, but authorization is
`vote_access`'s job, not the code's.

**Signed-in voters are deduped for real.** A partial unique index makes
one-ballot-per-account a database invariant, and their ballot follows
them across devices instead of dying with their browser storage. This
applies whenever a voter *happens* to be signed in — including in
`anonymous` mode, where it costs nothing and yields strictly better data.

**Anonymous voters are deduped only by a browser-stored ballot id, and
that will be beaten.** Clearing storage lets someone vote again. The rate
limit is the real defence. A poll that must actually hold up should be
set to `members`.

## Backend design

### Schema (`adapters/sqlite/schema.sql`)

`tierlists` gains four columns:

- `vote_code TEXT UNIQUE` — NULL for an ordinary tier list; set once when
  the community copy is created and never changed thereafter. SQLite
  treats multiple NULLs as distinct, so ordinary rows never collide.
- `vote_access TEXT NOT NULL DEFAULT 'anonymous'` — `'anonymous'` or
  `'members'`.
- `voting_open INTEGER NOT NULL DEFAULT 0` — whether ballots are being
  accepted. Separate from `vote_code` on purpose: closing a poll must not
  destroy its public identity, so a closed poll's link keeps working and
  shows the final result.
- `source_tierlist_id TEXT` — NULL for an ordinary tier list, else the id
  of the original this was duplicated from. Lets the UI badge community
  copies, and lets the owner navigate original ↔ community version.

Two new tables:

```sql
CREATE TABLE IF NOT EXISTS tierlist_ballots (
  id            TEXT PRIMARY KEY,  -- the handle an anonymous voter's browser stores
  tierlist_id   TEXT NOT NULL,
  voter_user_id TEXT,              -- NULL for anonymous ballots
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_tierlist_ballots_tierlist
  ON tierlist_ballots(tierlist_id);

-- One ballot per account per tier list, enforced by the database rather
-- than by handler logic. Partial so that anonymous ballots (many NULLs)
-- never collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tierlist_ballots_one_per_voter
  ON tierlist_ballots(tierlist_id, voter_user_id)
  WHERE voter_user_id IS NOT NULL;

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
Not now — no evidence, and it adds write-path complexity.

### Opening voting

`POST /tierlists/:id/open-voting` `{access}` (authed, owner-scoped), in
one transaction:

1. Read the original's `data` — `{tiers, pool}`.
2. Insert a new `tierlists` row: same `owner_user_id`, name `"<original
   name> (community)"`, `source_tierlist_id` = original id, a freshly
   generated `vote_code`, `vote_access` = the requested mode,
   `voting_open` = 1, and `data` = **structure only** — every tier keeps
   its `id`, `label` and `color` but gets `bookKeys: []`, and `pool`
   becomes the full union of the original's pool and all its tiers' book
   keys.
3. Insert one ballot, `voter_user_id` = the owner, whose placements are
   the original's tier placements — the owner's vote.
4. Return the new tier list and its `voteCode`.

Code generation retries on a `UNIQUE` violation rather than pre-checking
for collisions — the check-then-insert race is the bug the constraint
exists to prevent.

The original is not modified. Opening voting twice creates two
independent community copies; that is allowed on purpose — re-running a
vote later is legitimate.

### Service surface

- `openVoting(ownerUserId, id, access)` — as above; `undefined` if not
  found or not owned, matching the module's existing convention.
- `setVotingAccess(ownerUserId, id, access)` — switches
  `anonymous`/`members` while open. **Ballots already cast are kept**,
  including anonymous ones when tightening: they were cast in good faith
  under the rule in force at the time.
- `closeVoting(ownerUserId, id)` / `reopenVoting(...)` — flips
  `voting_open`. Ballots and `vote_code` survive both.
- `getResults(tierlistId)` — the histogram plus `ballotCount`.
- `getVotingBoard(code)` — the community copy resolved for public display.
- `submitBallot(code, placements, voter)` / `updateBallot(...)` /
  `getBallot(...)`, where `voter` is either a user id or an anonymous
  ballot id.

Placement validation rejects (400) any `book_key` not in the copy's pool
or any `tier_id` not among its tiers, and any ballot longer than the pool.

### Ballot identity

- **Signed in** → the ballot is found or created by `(tierlist_id,
  voter_user_id)`. Any ballot id the client sends is ignored; the unique
  index is the authority.
- **Anonymous** → found or created by the ballot id the browser stored,
  returned by the first submission.

### Routes

Authenticated, in the existing unthrottled scope:

- `POST /tierlists/:id/open-voting` `{access}` → `201 {tierlist, voteCode}`
- `PUT /tierlists/:id/voting` `{access?, open?}` → `{tierlist}`
- `GET /tierlists/:id/results` → `{histogram, ballotCount}`

Public, registered in a **new encapsulated scope with a tight
`@fastify/rate-limit`** — the same builder split
`modules/murals/plugin.ts` uses for `GET /murals/shared/:token`, and
precisely the split `modules/tierlists/plugin.ts`'s own comment says the
module doesn't have yet:

- `GET /tierlists/voting/:code` → the board: name, tiers, pool,
  `access`, and whether voting is open. Books resolved through
  `resolvePublicLibraryData` (library's public surface), the same
  redaction path the shared-mural route already uses for tier-list blocks.
- `POST /tierlists/voting/:code/ballot` `{placements}` → `201 {ballotId,
  results}`
- `PUT /tierlists/voting/:code/ballot/:ballotId` `{placements}` →
  `{results}`
- `GET /tierlists/voting/:code/ballot/:ballotId` → `{placements, results}`
  — rehydrates a returning anonymous voter. A signed-in voter's ballot
  comes back with the board instead, since it's keyed by their account.

Responses:

- Unknown code → 404.
- `voting_open = 0` → the board still resolves and results are returned;
  ballot writes are `409`. A closed poll stays readable, because the code
  is the resource's permanent identity.
- `vote_access = 'members'` with no valid access token → `401` on ballot
  writes. The board itself remains readable, so someone following the
  link sees what they'd be signing in for.

### Cross-module addition to `auth`

The ballot routes need "who is this, if anyone" — `authGuard` can't serve,
since it rejects outright. `modules/auth` gains one export alongside it:

```ts
getOptionalAuthenticatedUser(request): AuthenticatedUser | null
```

A plain function, not a preHandler — so there's no Fastify decoration, no
preHandler ordering to reason about, and no need to widen the
`request.user` type declaration into a lie on genuinely public routes.
It lives in `guard.ts` next to `authGuard` and is re-exported from
`modules/auth/index.js`; nothing else about auth's public surface changes.

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
- **Public `/vote/:code` page** — unauthenticated route alongside
  `SharedMuralPage`. Blank board → rank → submit → results. For anonymous
  voters the ballot id goes to `localStorage` keyed by code, so a return
  visit rehydrates and allows editing. In `members` mode an unauthenticated
  visitor sees the board with a sign-in prompt in place of submit.
- **Results view** — segmented control (Average · Most-voted · Median),
  the control Arena already uses. Per-book vote count and spread are
  visible in every mode, since a book with one vote is not as settled as
  one with two hundred. A closed poll renders the same view, marked final.
- **Owner UI** — "Open for voting" in the tier list editor with the
  access choice, which navigates to the new community copy and surfaces
  its link, ballot count, an access toggle and a close/reopen control.
  Community copies are badged in the Arena tier lists tab and their
  structural controls are absent, with a line explaining that a community
  list is frozen and that the original remains editable.

## Known simplifications (stated, not hidden)

- **Anonymous dedupe is a browser-stored id, and will be beaten.** See
  "Identity, access, and dedupe". `members` mode is the answer when it
  matters.
- Voting anonymously and then signing in and voting again produces two
  ballots — the anonymous one is not claimed or merged. Impossible in
  `members` mode.
- No voter names or per-ballot identity in the UI — ballots are anonymous
  to everyone, including the owner, even when tied to an account.
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
  ballot submit and edit, anonymous and signed-in; the unique index
  rejects an account's second ballot; `members` mode refuses an
  unauthenticated write but still serves the board; switching access
  keeps existing ballots; a closed poll serves results and refuses
  ballots; unknown book key or tier id is rejected; histogram counts
  including the owner's ballot; unranked books produce no rows.
- Frontend: `cd frontend && npm run typecheck && npm run lint && npm run
  build`, plus `lib/tierlistResults.test.ts` covering mean, plurality,
  median, ties, single-vote and zero-vote books, and unranked exclusion.
- Manual: open voting on a list, vote from a private window, confirm the
  results gate, switch all three modes, edit the ballot on a return
  visit, switch the poll to members-only and confirm the anonymous window
  can read but not submit, sign in and confirm one ballot per account,
  close voting and confirm the link still shows final results.
