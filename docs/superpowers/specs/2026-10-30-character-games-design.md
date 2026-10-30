# Character games — design

## Why

Characters exist for games (`2026-10-25-book-characters-design.md`). The first game was the `characters_title` quiz question. This release adds the next two: a **character tier list** ("rank the Harry Potter characters") and a **character tournament** ("Frodo vs Gandalf, vote"). Games are Scripta's social layer, and a series' cast is the most shareable subject a reader has. Everyone who read the books has an opinion, including people who don't own them.

## Decisions

**Carried from the user (2026-10-25), not re-asked:**
- Characters are for games and come only from the catalog. Owners never type or edit a character name.
- A character's identity is per series, otherwise per work. Harry Potter on all seven books is one character.
- This release has no character search and no metrics.
- The app should be social.

**2026-10-30:** the user skipped the design questions ("skip"). Every call below is Claude's and open to the user's override while they read this. The most consequential calls come first.

1. **Character games are a mode of the existing tier lists and tournaments, not new game kinds.**
   - A tier list or tournament gains an optional `subject`. `null` means books, which covers every existing row. A characters subject means the items are characters.
   - Voting, results, ballots, promotion, share links, the community feed, discover, profiles and participation all keep working through the existing `tierlist`/`tournament` game kinds. `GAME_KINDS`, `PublishedContent`'s union and `CommunityEventType` stay as they are.
   - A new game kind would copy two modules for the sake of one different item type.
2. **One game is one cast.** A character game covers exactly one scope: a series' cast, or one book's cast when the book has no series. The owner chooses which members of that cast go in. Mixing casts ("best fantasy villains") is out of scope. Each item still stores its full identity, so mixed games can come later without a migration.
3. **Started from the book screen only.** Below the existing "Characters:" line, on web and mobile, there is a "Make a character game" action.
   - It appears when the book's own cleaned list has at least 4 names, which the screen model already holds at no extra cost.
   - It opens a cast picker for the book's whole scope.
   - The Games hub's create buttons stay books-only. Starting there would need character search, which is out.
   - Accepted gap: a series volume whose own list has fewer than 4 names shows no action, even when the series cast is larger. Open Library lists the main cast on most volumes, so another volume will show it.
4. **Any book, not only the user's own.** Characters are catalog data, so a character game doesn't need the book to be in the user's library. A book game's publish check "a selected book is no longer in your library" does not apply.
5. **The game freezes its cast.**
   - At creation the server reads the cast from the catalog and stores each chosen character's id and display name on the game.
   - Later catalog changes never rename or remove an item in an existing game: a cleanup rule, a re-fill, or a series that lands later.
   - A game made before a book gained its series keeps its per-work ids. New games use the series ids. This split is accepted. It is the price of the "derived on read" identity that the characters spec chose.
6. **The character id is `ch:` + scope + `|` + name key.**
   - The scope is `s:<series name_key>` or `w:<canonical work id>`. The name key is `personNameKey`.
   - Examples: `ch:s:harry potter|harry potter`, `ch:w:<uuid>|frodo baggins`.
   - The id is an opaque string to clients, and only the books module builds it.
7. **Character tiles are text, with no portrait.** The catalog has no character images.
   - A character tile has the same footprint as a cover tile in the tier board, the sort deck, the arena duel, the bracket and the share image.
   - It shows the name on the `accentSoft` background, in the style the book-cover text fallback already uses (`mobile/src/features/tierlists/TierBoard.tsx:16-21`), with no author line.
   - The game's header shows the scope's cover and a "Characters · <scope label>" caption, so the cast's book stays visible.
8. **Character games stay out of Top Shelf and out of "games about this book".**
   - Top Shelf ranks books by work id, and a character item is not a book.
   - Book-page discovery (`discoverByWorks`) is left for later, together with metrics.
   - Character games still appear in the feed, discover search (by name), profiles, participation and the voted lists.
9. **Snapshots are book-shaped, so older clients degrade instead of breaking.** A character item goes into the existing item snapshots as a `PublicBookData`-shaped entry:
   - `workId` and `key` are the character id;
   - `title` is the name;
   - `author` is the scope label;
   - `coverUrl`, `isbn`, `imageId` and `readStatus` are `null`.
   - Tier lists put these entries in `public_books`. Tournaments put them in slot and duel `title`/`author`/`cover_url`, with `work_id` holding the character id.
   - Phones still on an older bundle render such an item as a book with no cover, which is close to the new tile.
   - Known wart: older mobile clients may guess a cover from the title through `/covers/resolve` (`mobile/src/features/library/components/CoverImage.tsx:18-27`). A "Harry Potter" tile could then show a Harry Potter book cover until the phone takes the OTA. That is accepted. New clients never call `CoverImage` for a character item.
10. **Noise is the owner's to deselect.** The cast picker lists the whole cleaned cast. The owner unticks real people, "God" or a namesake merge. There is still no deny list.
11. **Tournaments from characters are seeded randomly and started in one step.**
   - The owner picks a bracket size from the powers of two that fit the selected count, from 4 up to the existing 128 cap.
   - The server creates the tournament, fills its slots from the selected characters in a random order, and starts it, using the existing random-fill shuffle.
   - The library-driven seed screen is not used for characters.
12. **Tier lists from characters open in the existing editor** as a private draft. The pool is the selected characters and the tiers are the default preset. The owner ranks the characters and publishes through the existing flow.
13. **The owner's own lists are opt-in for character games.**
   - `GET /tierlists` and `GET /arenas/mine` return games with a subject only when the client sends `subjects=characters`. This is backend/AGENTS.md's rule for a new row kind.
   - An older bundle would open a character draft in a library-driven editor that cannot resolve its items. One save from that editor could then empty the pool.
   - Public surfaces include character games without the parameter, because their book-shaped snapshot renders on old clients (decision 9). Those surfaces are the vote page, the arena view, the feed, discover, profiles and the voted lists.
   - Cost: an owner on an old phone cannot see their own character games there, or break a tie in one, until the phone updates. The web is always current.

## The cast

A new read in the books module: `castOf(workId)`. It is exported from the books module's entry point and reached by the works, tierlists and arena modules through their ports.

1. Resolve `workId` to its canonical work.
2. **Scope.**
   - If the work has a best series (`bestSeriesOf`), the scope is that series. Its key is the series' `name_key`. `bestSeriesOf` doesn't return the key today; either add it or recompute it with `seriesNameKey(name)`, whichever the builder finds cleaner.
   - The scope's member works are the canonical works whose own best series has that same key. Gather candidates from every `work_series` row with the key, then keep those whose best series matches. A work listed under both "Discworld" and "Discworld - Rincewind" belongs only to its best one.
   - Without a series, the scope is the work alone.
3. **Characters.**
   - Read every member's people with the existing alias-aware `charactersOf`, which keeps the "no alias union" rule.
   - Union across member works by `personNameKey`. Across different works the union is the identity rule itself, so it doesn't conflict with the alias rule.
   - Display name: the spelling used in the member work with the lowest series position, ties broken by work id.
   - Order: most member works containing the character first; then the best position inside a list; then the name.
4. **Return value:**

   ```
   { scope: { kind: "series" | "work", key, label, coverUrl, workCount },
     characters: [{ id, name, works }] }
   ```

   - `label` is the series name or the work's title.
   - `coverUrl` is the starting work's catalog cover, the same choice `works/service.ts:98` makes for the book screen minus the viewer's own copy.

**Route:** `GET /works/:id/cast` in the works module. It takes optional auth and returns `no-store` like `POST /works/characters`. It answers 404 for an unknown work. A known work with no people gets an empty `characters` array.

## Tier lists

- **Storage:** a new nullable `subject` TEXT column on `tierlists`, added by the module's boot migration.
  - The JSON is `{ kind: "characters", scope: {kind, key, label, coverUrl}, characters: [{ id, name }] }`, the frozen cast from decision 5.
  - `Tierlist`, `VotingBoard` and `TierlistSummary` gain `subject: CharacterSubject | null`.
  - The type lives in `@scripta/shared`.
- **Create:** `POST /tierlists` accepts an optional `characters: { workId, characterIds }` in place of `data`.
  - The server calls `castOf(workId)` and rejects an id not in the cast. It requires at least 4 ids and at most the existing 500 pool cap.
  - It builds the subject and a default-preset board whose pool is those ids in cast order.
- **Board validation:**
  - For a character list, `storedBoard` checks that every id is one of `subject.characters` and that ids are unique. It does not call `knownWorkIds`.
  - `tierlist_works` gets no rows for a character list. That keeps it out of `discoverByWorks`, tier placements and shelf works, all of which join through that table.
- **Publish:** `public_books` is built from the subject (decision 9), not from the owner's library.
- **Cover peeks are skipped** for character lists in `fillMissingCovers`, `fillPublicBooks` and `publishedCovers`. Otherwise a title peek would put a book cover on "Harry Potter" the character.
  - A character list's `covers` is `[subject.scope.coverUrl]` when that cover is set, else `[]`.
  - The voted-on ranking preview emitted to the community uses the same entries with `coverUrl: null`.
- **Routes and wire layer:**
  - The tier list routes canonicalize every id through the works layer: `knownWorkIds` on ballot submit (`tierlists/routes.ts:292`) and `boardBooks`/`canonicalFirst` (`tierlists/wire.ts`).
  - For a list with a subject they use the identity mapping instead. Ids are already canonical, and the vote board's `books` is `characterSnapshot(subject)` in pool order.
- **More cover peeks:** `fillRankingCovers` (`service.ts:516`, read-time feed ranking) and `participationByOwner` (`service.ts:548`) also skip peeks for a list with a subject.
- **Murals** cannot embed a character list. A mural renders a tier list through the owner's library, so the mural block pickers on web and mobile leave out lists with a subject.
- **Top Shelf:** `shelfFacts` leaves out lists with a subject.

## Tournaments

- **Storage:** a new nullable `subject` TEXT column on `tournaments`, with the same JSON. `Tournament` and `TournamentSummary` gain `subject`.
- **Create:** `POST /arenas` accepts an optional `characters: { workId, characterIds }`.
  - The `bracketSize` must be a power of two from 4 to 128 and no larger than the number of ids.
  - With `characters`, the service validates the ids against `castOf` and stores the subject. It then fills the slots by shuffling the selected ids, keeping `bracketSize` of them, and starts the tournament in the same call. The response is the started tournament.
  - Slot rows: `work_id` is the character id, `title` is the name, `author` is the scope label, `cover_url` is `null`.
- **Seeding routes:** `setSlotsManual` and `randomFill` reject a character tournament, because it is already started.
- **Votes and tiebreaks:** these name a side by `workId` and resolve through `canonicalWorkIds` (`arena/service.ts:189-196`), which falls back to the id itself. A character id therefore matches its own side unchanged. The builder confirms this with a test rather than assuming it.
- **Top Shelf:** `topShelfFacts` leaves out tournaments with a subject.
- **`discoverByWorks`** reads slot `work_id`s, which never match a real work for a character tournament. A test pins that.

## Clients (web and mobile)

- **Book screen:** the "Make a character game" action from decision 3. It opens the cast picker: on mobile the pushed screen `work/[id]/characters` in the signed-in group, on web the page `/work/:id/characters`.
- **Cast picker:**
  - The header shows the scope cover, the label and "N books" for a series.
  - Below it, a tier list / tournament choice.
  - Then the cast as a ticked list, in cast order.
    - For a tier list, the first 20 are pre-ticked.
    - For a tournament, a bracket-size control offers the sizes that fit, and the first N are pre-ticked.
  - A name field, prefilled with "<label> characters".
  - A create button. It stays disabled until the ticked count is valid: at least 4 for a tier list, exactly the bracket size for a tournament.
  - The round duration uses the arena's existing default and control.
- **After create:** a tier list opens its editor. A tournament opens its view screen.
- **Rendering:** clients already turn ids into library-shaped book records and look them up with `booksByWork` (for example `mobile/src/features/tierlists/tierBoardData.ts:47`). A character game keeps that path.
  - `@scripta/shared` gains `characterBooks(subject)`. It returns one record per character: `{ Title: name, _workId: id, _character: true }`.
  - With a subject, a screen passes these records wherever it passes library or `publicBooks` records today.
  - Tier list tiles branch on `_character` and render the character tile without `CoverImage`:
    - mobile `TierCover`;
    - web `MiniBookTile` and `DraggableTierTile` (`frontend/src/components/murals/blocks/BookBlocks.tsx`);
    - the web vote page's own tile.
  - The board, sort deck, results and share image then need no branch of their own. The share image waits for every tile's `onLoadEnd`, so a character tile fires it on mount.
  - Arena components take `{cover, title}` from the slot snapshot, not a book record.
    - On mobile, `BookCover` with `cover: null` already renders the title alone.
    - On web, `DuelCard` and `BracketMap` build a book and call `CoverImage`. They take a `character` flag from `tournament.subject` and render the character tile instead.
  - The editor hides "add books" for a character list.
  - The game header shows the scope cover and caption (decision 7).
- **Owner lists:** the clients' `GET /tierlists` and `GET /arenas/mine` calls send `subjects=characters` (decision 13).
- **Community cards** for a game with a subject read "N characters" instead of books, and show the scope cover. For tournaments the server returns `covers: [scope.coverUrl]`, because slot covers are null. All "book"/"character" copy comes from one shared helper.
- **Copy** that says "book" in these flows says "character" when `subject` is set. Accessibility labels read "<name>" instead of "<title> by <author>".

## Goals

- From a Harry Potter book page, a reader can make a character tier list or tournament in under a minute, publish it, and share the link.
- Anyone, signed in or not, can vote on it on web or mobile, exactly as on a book game.

## Non-goals (this release)

- character search, and starting from the Games hub
- character metrics and stats, and Top Shelf for characters
- character games on the book page's games list (`discoverByWorks`)
- mixed-cast games
- character portraits or images
- a noise deny list
- a manual seed order for character tournaments
- places and times

## Anti-goals

- **Never let a client name a character.** Create takes ids and the server freezes the names from the catalog.
- **Never let a character id reach a work-keyed read** as if it were a work: Top Shelf, genre boards, cover peeks, `knownWorkIds`.
- **Never break a book game.** Every existing row has `subject = null`, and that path is unchanged.

## Deploy impact

- **Database:** two nullable columns, added on boot by each module's migration. No new env var and no `*_DB_PATH`.
- **API:** additive. There is a new route, new optional request fields and new nullable response fields. Old clients degrade as in decision 9.
- **Mobile:** JS only. Phones get it by OTA; EAS CI minutes return 11-01, otherwise a manual OTA.
- **Operations:** no backfill and no production command.

## Left to the builder

- whether `bestSeriesOf` grows a `nameKey` or the key is recomputed
- the exact `CharacterSubject` type name and file in `@scripta/shared`
- where the subject branch sits in each client component, so long as no component calls `CoverImage` for a character item
- test layout, following each package's AGENTS.md
