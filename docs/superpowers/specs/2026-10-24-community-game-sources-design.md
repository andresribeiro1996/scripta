# One game contract for community

From the 2026-10-24 architecture review (candidate D), designed twice; this is the hybrid the user chose. Community knows each game by name:

- `CommunityDeps` (`community/service.ts:110-146`) has three blocks, `tierlists`, `tournaments` and `quizzes`, with the same six methods (`discoverWindow`, `getPublishedMany`, `votedAmong`, `get`, `listByOwner`, `discoverByWorks`) and different Ref types. It also has a `participation` block with one function per game.
- Community builds each game's feed summary (`toTierlistSummary`, `toTournamentSummary`, `toQuizSummary`, 81-91) and branches by kind in `buildDiscoverItems`, `participationItems`, `toDigestItem`, `resolveSavedContent`, the profile's published lists, `getDiscover` and `getActivity`. `getActivity` builds each kind's link by hand (`/vote/…`, `/play/…`, `/arena/…`).
- Top Shelf takes three fact functions (`topShelfService.ts:11-13`) and maps them three ways, there and in `topShelfRecapService.ts:23-25`.
- Community imports types from `../arena/service.js`, `../quizzes/service.js` and `../tierlists/service.js`, past their `index.ts`.
- `generateVoteCode` is byte-identical in `tierlists/service.ts:142` and `quizzes/service.ts:49`. `GameByWork` is declared in each game's service and again in `works/service.ts:5`.
- Quiz participation rows return `covers: []` (`quizzes/service.ts:~375`); tier lists and tournaments show covers.

## Decision

**The port belongs to community.** `community/domain/games.ts` declares it in `@scripta/shared/community` vocabulary, and `community/index.ts` exports it:

```ts
type GameKind = ParticipationGameKind;
GAME_KINDS: readonly GameKind[] = ["tierlist", "tournament", "quiz"];
interface GameListing { id; ownerUserId; createdAt; promoted: boolean }
interface GameCard<K> extends GameListing { content: Extract<PublishedContent, { kind: K }> }
interface GameShelfFact { kind; id; ownerUserId; open; promoted; createdAt; voters; votesSince; workIds; placements; champion }
interface GameSource<K> {
  get(id): GameCard<K> | undefined;
  getMany(ids, viewerId?): GameCard<K>[];
  listByOwner(ownerUserId): GameCard<K>[];
  discoverWindow(needle, limit): GameListing[];
  discoverByWorks(workIds, limit): GameListing[];
  participation(ownerUserId, since): Array<GameParticipation & { voteCode?: string }>;
  shelfFacts(since, until): GameShelfFact[];
}
type GameSources = { [K in GameKind]: GameSource<K> };
```

**Invariants.**
- `content.kind` is the source's kind, and `content.id` equals `id`.
- `getMany` sets `content.viewerVoted` exactly when `viewerId` is given; it absorbs `votedAmong`.
- `promoted` is true only for a tier list with `promotedAt`.
- `content.covers` is what the game's public API returns (up to 8 for tier lists and tournaments, 3 for quizzes). Community caps it at `FEED_COVER_LIMIT` (3) in one helper wherever a summary builder capped before, since the cap is feed policy.
- Missing, unpublished or still-seeding games come back as `undefined` or are left out; only storage errors throw.
- `listByOwner` is newest first.
- `placements` is `[]` and `champion` is `null` where they don't apply.

**Adapters.** Each game module's `adapters/communityGameSource.ts` builds its source from its public API, and its `index.ts` exports `get…GameSource()`. The summary builders move there with the Ref types, which stop leaving the module. The quiz service's participation fills covers from the quiz's books, through the same preview-cover rule its published refs use.

**Community.**
- `CommunityDeps` replaces the three blocks and `participation` with `games: GameSources`.
- Two named extras stay outside the port: `rankingCovers(tierlistId, ranking)` (today's `fillRankingCovers`) and `completedTournaments(viewerId, since)`, which returns `{ card, completedAt, winner }` and is exported by arena, since only arena can build its card.
- `TopShelfDeps` takes `games` instead of the three fact functions.
- Every per-kind branch becomes a loop over `GAME_KINDS`, or a lookup by `ref_type` through an `asGameKind` guard.
- Links come from the shared `contentTarget(content)`.
- What stays per kind: the tier-list ranking on vote items (the extra), tournament completions (the extra), the profile's wire shape `{ tierlists, tournaments, quizzes }`, and Top Shelf's tiered/quizzed/plain appearance rule, which is community's ranking policy.
- `CommunityRefType` becomes `GameKind | "book" | "user" | "mural"`.

**Shared helpers.** `generateVoteCode` moves to `backend/src/voteCode.ts`, beside `stallLog.ts`; it needs `node:crypto`, so not `@scripta/shared`. `GameByWork` is owned by works, its consumer, and exported from `works/index.ts`; the games' `publishedByWorks` return it.

## Behaviour changes

- A vote in your activity on a quiz that has since gone is kept as plain text, without cover or link, like tier lists and tournaments today. Every `voted_on` payload already carries the game's name (`app.ts:144, 243, 248`).
- Quiz participation rows show up to three of the quiz's book covers.
- A `voted_on` event with an unknown `ref_type` is no longer treated as a tournament.

## Not in scope

- Wire formats, including the profile's keyed `published` lists and every response shape.
- Unpublishing, promotion rules, and the Top Shelf ranking.
- The game publish rules (candidate B, its own spec), which this follows on the same lane.
