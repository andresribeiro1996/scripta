import type { TopShelf, TopShelfBook, TopShelfBoard, TopShelfGame, TopShelfPeriod, TopShelfView } from "@scripta/shared";
import type { CatalogWorkPage } from "../books/index.js";
import { GAME_KINDS, type GameSources } from "./domain/games.js";
import type { EngagementRepository, GameRef } from "./domain/ports.js";
import { buildDiscoverItems, type CommunityDeps, type DiscoverEntry } from "./service.js";
import { rankTopShelf, topShelfMonthStart, type Ranked, type ShelfInput } from "./topShelf.js";

export interface TopShelfDeps {
  games: GameSources;
  canonicalWorks(ids: string[]): Map<string, string>;
  catalogGenres(workIds: string[]): Map<string, { genres: string[] }>;
  getWorkPage(id: string): CatalogWorkPage | undefined;
}

export type TopShelfQuery = { period: TopShelfPeriod; genre: string | null; view?: TopShelfView };

export interface TopShelfService {
  getTopShelf(query: TopShelfQuery): TopShelf;
}

export type DiscoverDeps = Pick<CommunityDeps, "repo" | "games" | "resolveProfiles" | "readerGlyphFor">;

const CACHE_MS = 60_000;
const PODIUM = 3;
const BOARD_PREVIEW = 1;
const FULL_BOARD = 10;

export interface ShelfGatherer {
  gather(since: string | null, until: string | null): ShelfInput;
  cached(since: string | null): ShelfInput;
}

export function workCard(shelf: Pick<TopShelfDeps, "getWorkPage">, workId: string): Omit<TopShelfBook, "value"> | null {
  const page = shelf.getWorkPage(workId);
  return page ? { workId, title: page.title, author: page.author, coverUrl: page.editions.find((e) => e.coverUrl)?.coverUrl ?? null } : null;
}

export function createShelfGatherer(deps: { engagementRepo: Pick<EngagementRepository, "gameEngagement">; community: DiscoverDeps; shelf: TopShelfDeps; now: () => number }): ShelfGatherer {
  const { engagementRepo, community, shelf, now } = deps;
  const cache = new Map<string, { at: number; value: ShelfInput }>();

  const gather = (since: string | null, until: string | null): ShelfInput => {
    const games = GAME_KINDS.flatMap((kind) => shelf.games[kind].shelfFacts(since, until));
    const refs: GameRef[] = games.map((f) => ({ kind: f.kind, id: f.id }));
    const ownerIds = [...new Set(games.map((f) => f.ownerUserId))];
    const workIds = new Set<string>();
    for (const f of games) {
      for (const id of f.workIds) workIds.add(id);
      for (const p of f.placements) workIds.add(p.workId);
      if (f.champion) workIds.add(f.champion.workId);
    }
    const canonical = shelf.canonicalWorks([...workIds]);
    return {
      games,
      engagement: engagementRepo.gameEngagement(refs, since, until),
      visibleOwners: new Set(community.resolveProfiles(ownerIds).keys()),
      canonical,
      genres: shelf.catalogGenres([...new Set(canonical.values())]),
    };
  };

  return {
    gather,
    cached(since) {
      const at = now();
      const key = String(since);
      let hit = cache.get(key);
      if (!hit || at - hit.at >= CACHE_MS) {
        hit = { at, value: gather(since, null) };
        for (const [k, entry] of cache) if (at - entry.at >= CACHE_MS) cache.delete(k);
        cache.set(key, hit);
      }
      return hit.value;
    },
  };
}

export function createTopShelfService(deps: { gatherer: ShelfGatherer; community: DiscoverDeps; shelf: TopShelfDeps; now: () => number }): TopShelfService {
  const { gatherer, community, shelf, now } = deps;

  const compute = ({ period, genre, view }: TopShelfQuery, since: string | null, input: ShelfInput): TopShelf => {
    const ranked = rankTopShelf(input, { since, genre });

    const sizeOf = (board: TopShelfBoard) => (view === undefined ? (board === "champions" ? PODIUM : BOARD_PREVIEW) : FULL_BOARD);
    const picked: Array<[TopShelfBoard, Ranked[]]> = [];
    if (view === undefined) for (const [board, list] of Object.entries(ranked.boards) as Array<[TopShelfBoard, Ranked[]]>) picked.push([board, list.slice(0, sizeOf(board))]);
    else if (view !== "games") picked.push([view, (ranked.boards[view] ?? []).slice(0, FULL_BOARD)]);
    const genreChampions = view === undefined ? ranked.genreChampions : [];

    const shownWorks = new Set<string>([...picked.flatMap(([, list]) => list.map((r) => r.workId)), ...genreChampions.map((g) => g.entry.workId)]);
    const cards = new Map<string, Omit<TopShelfBook, "value">>();
    for (const id of shownWorks) {
      const card = workCard(shelf, id);
      if (card) cards.set(id, card);
    }
    const book = (r: Ranked): TopShelfBook[] => {
      const card = cards.get(r.workId);
      return card ? [{ ...card, value: r.value }] : [];
    };

    const gameLimit = view === undefined ? PODIUM : view === "games" ? FULL_BOARD : 0;
    const topGames = ranked.games.slice(0, gameLimit);
    const entries: DiscoverEntry[] = topGames.map((g) => ({ kind: g.ref.kind, id: g.ref.id, userId: g.ownerUserId, promoted: g.promoted, createdAt: g.createdAt }));
    const items = new Map(buildDiscoverItems(community, entries).map((item) => [`${item.content.kind}:${item.content.id}`, item]));
    const games = topGames.flatMap((g): TopShelfGame[] => {
      const item = items.get(`${g.ref.kind}:${g.ref.id}`);
      return item ? [{ item, likes: g.likes, votes: g.votes, comments: g.comments }] : [];
    });

    return {
      period,
      genre,
      genres: ranked.genres,
      boards: Object.fromEntries(picked.map(([board, list]) => [board, list.flatMap(book)])),
      genreChampions: genreChampions.flatMap((g) => book(g.entry).map((b) => ({ genre: g.genre, book: b }))),
      games,
    };
  };

  return {
    getTopShelf(query) {
      const since = query.period === "month" ? topShelfMonthStart(new Date(now())) : null;
      return compute(query, since, gatherer.cached(since));
    },
  };
}
