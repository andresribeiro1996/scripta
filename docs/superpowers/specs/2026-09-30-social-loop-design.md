# Social loop: a Community that talks back

## Context

On 2026-09-30 the user said the app feels isolating, even though it is meant
to be social. An audit of `cbc926ff` (origin/main, including #74) found that
the app broadcasts but never answers back:

- **Nothing comes back to you.** The Home digest shows only followees'
  events and new followers (`community/service.ts` `getDashboard`). Votes on
  your tier lists, votes in your tournaments and plays of your quizzes never
  reach you.
- **You can't answer anyone.** A feed row's only action is "Follow back".
  There are no replies, reactions or reports anywhere in the schema.
- **Hard to become visible.** Since #74 every username is findable, but an
  unpublished user can't be followed. Publishing needs a mural, and reading
  activity is off by default (`DEFAULT_FEED_SETTINGS`).
- **No reason to follow anyone.** People search stays empty until you type,
  and nothing suggests readers.
- **Social is hard to reach, and duplicated.** The Activity screen is only
  reachable from the bottom of Home. Games → Browse opens an older public
  list (`ArenaPublicListScreen`) that repeats Discover with less context.
  Discover loads only its first page.
- **The unread count is wrong.** `countEventsByUsersSince` counts events that
  the list hides (the publisher's feed settings) or never renders
  (`following`, `mural_published`). The Activity screen also marks everything
  seen on load, even when it opens on Discover or People.
- **Books have no other readers.** The book sheet is entirely private.

Two Codex reviews were folded in. This supersedes the 2026-09-24 review's
"no social prompts" posture: My shelf stays private by default, but personal
moments may now reach other people.

## Decisions locked in with the user

- **No separate inbox.** Activity covers both the people you follow and your
  own content. Each surface has one job:

  | Surface | Question it answers |
  |---|---|
  | Discover | What might interest me? |
  | People | Who might I connect with, and why? |
  | Activity | What happened among people I follow, or around something I did? |

- **The badge counts only interactions with you.** That means participation
  in your games, new followers, replies and next-read picks. New posts from
  people you follow get a quieter marker inside Activity.
- **Replies come before reactions**, and on one activity type only (a shared
  finish). Reactions are deferred.
- **Home stays Home.** Renaming the Activity screen to Community tidies
  navigation but doesn't create connection by itself.
- **Order:** (1) navigation, (2) feedback on your creations, (3) finding
  readers, (4) one conversation, (5) followers pick my next read. Each step
  gets its own implementation plan and PR.
- **Audience: both** friends the user invites and strangers from the Play
  Store. So finding readers comes before conversation, and replies get the
  full safety set.
- **Replies are free text**, with the safety minimum in step 4.
- **Sharing a finish is a per-post switch.** This overrides the 2026-09-16
  "no per-item audience settings" rule for this one case.
- **Every step ships on web and mobile**, so a reply or a vote never
  dead-ends on one client.
- **Codex's requirements hold:**
  - a Community shortcut in the Home header;
  - seen only when Activity is viewed;
  - guest browsing preserved;
  - complete browsing (books sheet and pagination);
  - participation grouped and counted once per game;
  - Browse lands on Discover, and Back returns to Games.

---

## Step 1: one Discover, and a Community screen

Mostly client work, plus one backend fix found while planning.

### Backend

`getDiscover` asks each content type for only `offset + limit` rows. That
breaks two things:
- a single-type filter ("Tier lists") never reports a next page;
- search only looks at the newest `offset + limit` items of each type.

The fix:
- without a search, fetch `offset + limit + 1` rows per type, so a next page
  can be detected;
- with a search, scan up to the existing 500-row cap.

### Mobile

**Discover at `/arena`.**
- `mobile/src/app/arena/index.tsx` renders a new `DiscoverScreen` (header
  title "Discover") wrapping the existing `DiscoverPane`, and
  `ArenaPublicListScreen` is deleted.
- The route stays in the root stack, outside the tabs. So:
  - guests can open it, and so can the `/arena` Android App Link;
  - Games → Browse still pushes it, and Back returns to Games with its list
    position intact.
- `fetchPublicTournaments` and `fetchPublicTierlists` lose their only caller
  and are deleted. The backend endpoints stay (compatibility).
- **Correction found in the device pass.** From the root-stack `/arena`, an
  author tap pushed a second copy of the tab shell, with Home highlighted and
  no back arrow. So:
  - Games → Browse pushes an in-tab Discover at `(app)/(arena)/discover`.
  - The profile route becomes a shared route, `(app)/(home,arena,library)/u/[username]`,
    so an author tap stays inside the Games tab.
  - The Games stack anchors `my-arena` as its first screen, so the new route
    can't become the tab's default.
  - `/arena` stays the public entry for links and guests. It shows author
    names as plain text, so it never pushes into the tab shell.

**`DiscoverPane` gains:**
- **Pagination.** `useInfiniteQuery` over `offset`/`nextOffset`, loading the
  next page on `onEndReached`. Today only 20 items show; the old list showed
  up to 70.
- **Guest access.** Send `auth` only when signed in. Today `fetchDiscover`
  always sends `auth: true`, which throws "Not signed in" for guests before
  any request (`apiClient.ts:129`). Guests get no "voted" state. Author taps
  go through the normal login redirect.
- **"See all N books" on tournament rows.** This opens `ArenaBooksSheet`, and
  from there `AddBookSheet`, both moved from the old list. `AddBookSheet`
  already shows a Sign in prompt to guests.

**The Activity screen becomes the Community screen.**
- `(home)/activity.tsx` → `(home)/community.tsx`, `ActivityScreen` →
  `CommunityScreen`, title "Community".
- The tabs become Activity · Discover · People ("Find people" becomes
  "People"). `?tab=` accepts all three values.
- Without `?tab=`, the screen keeps today's default: Activity if it has
  items, otherwise Discover (`defaultHomeTab`).
- **Home header:** a framed `community` `IconButton` on the right opens
  `/community`. Home's "All activity" and "Find readers" links point there
  (the Activity and People tabs).
- **Seen marker:** `markDashboardSeen` runs only once the Activity tab is
  showing with data loaded, not on Discover or People. This fix moves up from
  step 2 because this step rewires every way into the screen.

### Web

- **`/arena`:** signed in, redirect to `/community/discover` (as today).
  Signed out, render a public Discover page, the same pane in public chrome,
  like the `/` landing split.
  - This also fixes the back link on public tournament pages
    (`ArenaViewPage.tsx:110`), which today sends guests to a sign-in wall.
- Web `DiscoverPane` gets "Load more" pagination (`useInfiniteQuery` over
  `offset`). Web never had the books preview; none is added.

### Testing

- **Mobile unit:**
  - Discover pages through `nextOffset`;
  - a guest's Discover request carries no auth;
  - tab labels and `?tab=` parsing;
  - `markDashboardSeen` is called only when the Activity tab is shown.
- **Web:** `/arena` for a guest vs a signed-in user; Load more appends.
- **One emulator pass** if the lease is free: Games → Browse → Discover →
  Back returns to Games at the same scroll position, and the Home header
  button opens Community.

---

## Step 2: your creations talk back

### What the owner sees

- **One row per game of yours that other people took part in**, whether a
  tier list, tournament or quiz. For example: "Ana, Rui and 10 others ranked
  your *Sci-fi* tier list", with the game's covers.
- **The row's time is the latest first-participation.** A new participant
  moves the row to the top, and the row counts as one new item.
- **What counts as a participant:**
  - Ballot edits and repeat duel votes add nothing: tier lists use the
    ballot's `created_at`, not `updated_at`, and tournaments count distinct
    voters.
  - A tournament becomes new again only when someone *new* votes. Round
    progress lives in the tournament itself.
  - The owner's own ballot, vote or play is excluded (`openVoting` seeds the
    owner's ballot).
- **Who gets named:** up to three signed-in participants with a published
  profile and their `votes` feed setting on, latest first. Everyone else,
  guests included, is counted in "N others". So a private voter is never
  named to the owner.
- **Tapping a row opens the owner's results:**

  | Game | Mobile | Web |
  |---|---|---|
  | Tier list | `/tierlist/:id` | `/dashboard/arena/tierlist/:id` |
  | Tournament | `/arena/:id` | `/arena/:id` |
  | Quiz | `/quiz/:id` | `/dashboard/arena/quiz/:id` |

### Backend

**Approach: derive at read time from the games' own tables.** This is the
same way new followers come from `follows` rather than from events. Recording
new events at vote time was considered and rejected:
- only signed-in voters emit events, and tournaments are mostly anonymous;
- the games' own tables already deduplicate ballot edits and repeat votes;
- deriving shows existing participation on day one, with no backfill.

**Each game module gains a public read**, injected into community the way
`listByOwner` already is:
- `tierlists`: `participationByOwner(ownerUserId)`
- `arena`: `participationByOwner(ownerUserId)`
- `quizzes`: `participationByOwner(ownerUserId)` (quizzes are wired into
  community for the first time)

**Each read returns, per game with at least one participant:**
- `{ id, name, covers }`
- `participantCount`, not counting the owner
- `latestAt`, the latest first-participation time
- `recent`, up to 10 signed-in participants, latest first, as
  `{ userId, at }`

**How each game counts a participant:**

| Game | Participant | First participation |
|---|---|---|
| Tier list | a ballot | the ballot's `created_at` |
| Tournament | distinct `COALESCE(voter_user_id, voter_token)` | their earliest vote's `created_at` |
| Quiz | a play | the play's `created_at` |

**The dashboard** merges these as
`{ kind: "participation", id: "<kind>:<gameId>", content, actors, count, createdAt: latestAt }`
rows into the existing keyset stream on `(createdAt, id)`.

**Page 1 carries three new fields** in place of `newCount`:
- `seenAt`, the viewer's marker before this visit;
- `personalNewCount`, participation and follow rows newer than `seenAt`
  (replies and picks join in steps 4 and 5);
- `followingNewCount`, followee rows newer than `seenAt`.

Both counts come from the same row-building code as the list, so hidden and
unrendered events no longer count. This replaces `countEventsByUsersSince`.
Clients display at most "99+".

### Shared

- `DigestItem` gains `participation`. `digestAction`, `digestHeading` and
  `digestTarget` cover it. Mobile remaps targets as `digestRoute` already
  does for profiles.
- `DashboardFeedPage` becomes
  `{ items, nextCursor, seenAt, personalNewCount, followingNewCount }`, and
  every consumer is updated in the same step.

### Mobile

- **`FeedRow`** renders participation rows: a cover fan, up to three
  avatars, the label "Ranked", "Voted" or "Played", and "Ana, Rui and 10
  others".
- **The personal badge** (`personalNewCount`) appears in three places:
  - on the Home tab (`tabBarBadge`, reading the same dashboard query);
  - on the Community header button (`IconButton` gains an optional badge
    that reuses `SwipeableTabs`' `tabBadge` style);
  - on the Activity tab inside Community.
- **Inside Activity**, rows newer than `seenAt` carry a small "new" dot.
- **Home's last section** is retitled from "From people you follow" to
  "Activity".

### Web

- Home's "Following" section becomes "Activity" and renders participation
  rows.
- The Home nav item shows the personal badge.
- Seen is marked when the Activity section scrolls into view
  (IntersectionObserver), not on page load.

### Edge cases

- **Deleted game:** the module returns nothing for it, so there is no row.
- **Deleted participant account:** their ballots, votes and plays go with it,
  and the counts drop.
- **Promoted tier list:** ownership stays `origin_user_id`, matching
  `listPublishedByOwner`.
- **Unpublished owner:** still sees their own participation rows.

### Testing

- **Backend service:**
  - grouping per game, with the owner excluded;
  - guests counted but not named;
  - naming gated by published profile and the `votes` setting;
  - "new" only on first participation after `seenAt`;
  - both counts equal the rows the list returns;
  - keyset order stays stable with participation rows mixed in.
- **Each game repository:** a `participationByOwner` test, with new test
  files added to backend `npm test`'s explicit list.
- **Shared:** `digestAction` and `digestTarget` for participation.
- **Clients:** row rendering, the badge value, and the "new" dot.

---

## Step 3: finding readers

### Suggested readers

- **People with an empty search** shows suggestions instead of an empty
  state. It lists published, followable readers you don't follow yet, ranked
  by books in common, each with a reason: "You share 6 books" plus up to
  three shared covers. If fewer than five suggestions have any overlap, the
  list fills with recently active published readers.
- **Matching:** two books match when their ISBN key *or* their
  title-and-author key match, using `bookKey`'s normalization. A small shared
  `bookMatchKeys(book)` returns both keys, because `bookKey` returns only
  one.
- **Privacy:** only data already public on a published profile is used (its
  Library tab shows titles and statuses). Private users never appear.
- **Endpoint:** `GET /community/people/suggested?limit=` (authed). It is
  computed per request over the 500 most recently updated published profiles
  through the existing `resolveLibrary` dep, which is enough at current
  scale.

### A profile without a mural

- **Publishing no longer needs a mural.**
  `PUT /community/profile/publish` takes an optional `muralId`. Without one,
  it publishes with the current shelf mural if there is one, or none.
- **What visitors see:** the header, Activity and Library. The Mural tab
  shows the profile-only block, which `profileOnlyMural` already provides.
- **My shelf's Private chip** publishes directly, after the choice below,
  instead of forcing the mural picker when there is no shelf mural.

### A clear choice about reading visibility

- **Publishing asks one question with nothing preselected:** "Share what you
  read and finish with followers?" The answers are **Share my reading** or
  **Keep my reading private**. It sets `feedSettings.reading`, and Feed
  settings still changes it later.
- **Existing published users** keep their current setting and are not asked
  again.

### Testing

- **Suggestions:**
  - ranking by overlap;
  - both match keys;
  - excluding private users, yourself and people you already follow;
  - the recently-active fill.
- **Publishing:**
  - publishing without a mural;
  - the choice writes `reading`.
- **Clients:** the suggestion row, and the publish flow with and without a
  shelf mural.

---

## Step 4: one conversation (a thought when you finish, and replies)

### Sharing the finish

- **The finish screen's "A thought to keep"** gets a **Share with
  followers** switch. It is off by default and remembers the last choice.
- **On Done with the switch on**, the client calls
  `PUT /community/reading/share` with `{ contentId, thought, feeling }`.
  - This attaches `{ shared: true, thought, feeling }` to the viewer's
    latest `book_finished` event for that book.
  - Events are matched by `ref_id`, the library's `ContentID`.
  - `contentId` travels in the body, because Kobo `ContentID`s can be file
    paths containing slashes.
- **A shared finish reaches followers**, and the public Activity tab, even
  when the `reading` category is off. Unshared finishes keep following the
  category.
- **The thought is still saved as a private library note**, as today.

### Replies

- **Storage:** a `replies` table in the community database, with
  `id, event_id, author_id, body (1–500 chars), created_at`.
- **Who can reply:** anyone signed in who can see the shared finish.
- **The thread screen** shows the finish (book, feeling, thought), the
  replies and a composer. There are quick-reply chips such as "Loved it too"
  and "It's on my list"; the second also adds the book to your To read
  through `POST /library/books`.
- **Deleting:** you can delete your own replies, and the thought's author
  can delete any reply on it.
- **Personal rows,** grouped per thread and counted once:
  - the author gets "Ana replied to your thought on *Piranesi*";
  - earlier repliers get "Andre replied on *Piranesi*".

### People beside the books

- **The book sheet gains "Readers you follow".** It lists published
  followees who have this book in their public library, with their status.
  If one of them shared a finish thought on it, the thought's first line
  opens the thread.
- **Endpoint:** `GET /community/books/readers?isbn=&title=&author=`, matched
  with `bookMatchKeys`. It uses only public library data plus shared
  finishes.
- **Acceptance journey:** you open a book, see that Ana finished it, read her
  thought and reply. Next time you open the app, her answer is waiting.

### Safety: Google Play's user-generated content policy

Free-text replies bring Play's user-generated content requirements: accepting
terms before posting, in-app reporting of content and users, blocking users,
and acting on reports. The minimum set:

- **Report** a reply or a user, stored in a `reports` table.
- **Block** a user, stored in a `blocks` table. A blocked user can't follow
  you, reply to you or vote in your polls, and their content is hidden from
  you.
- **Accept terms of use** once, before the first reply. There is no terms
  page today, and the text needs the user's approval.
- **Moderation:** an admin list of reports on web, gated by the existing
  `ADMIN_USER_ID`, with delete and dismiss.

Note: some user-made text is already public (mural text, and tier list and
quiz names), with no report path yet.

### Testing

- **Backend:**
  - sharing attaches to the right event and overrides the category;
  - replies: permissions, deletion rights, grouping and counts;
  - readers matching and privacy;
  - blocks filter every surface;
  - reports reach the admin list.
- **Clients:** the thread flow, the chips, the readers section, and the
  report and block actions.

---

## Step 5: followers pick my next read

- **Asking.** "Can't choose?" on Home gains **Ask followers**: pick 2–3
  books from Up next. Only one poll can be open per reader.
- **Storage:** `next_read_polls` holds
  `id, owner_id, books (key, title, author, cover), status, winner_key, created_at, closed_at`.
  `next_read_votes` holds `poll_id, voter_id, book_key, created_at`, with
  primary key `(poll_id, voter_id)`.
- **Followers see it** through a `next_read_asked` event in the
  `publications` category, shown in their Activity as covers they can tap to
  pick. Signed-in followers only; a pick can be changed while the poll is
  open.
- **The owner sees** a personal row, "Ana and 2 others picked", grouped per
  poll. The poll screen shows the tally.
- **Closing:**
  - The poll closes when the owner starts any of its books, either from the
    poll's "Start *Piranesi*" or anywhere else.
  - Voters then get "Andre started *Piranesi*: you picked it" or "…: 3 of
    you picked it".
  - The owner can cancel the poll; nothing expires on a timer.
- **Why not reuse the arena:** tournaments are public, anonymous, timed
  brackets listed in Discover. This poll is for followers only, signed-in and
  untimed.

---

## Cross-cutting

- **Account deletion:** community's `deleteUserData` also removes replies,
  reports, blocks, polls and votes.
- **Rate limits:** the new routes fall under community's existing 30/min
  module scope.
- **Parity:** every step ships on web and mobile.
- **Notifications stay in-app.** Push is out of scope.

## Out of scope

Push notifications, reactions, replies on anything other than a shared
finish, quizzes in Discover, clubs or groups, buddy reads, and direct
messages.

## Still needed from the user

- **Terms-of-use text**, before step 4 ships. The app has no terms page
  today, and Play requires users to accept terms before posting replies.
