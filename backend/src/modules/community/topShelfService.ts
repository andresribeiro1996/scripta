import type { TopShelf, TopShelfBook, TopShelfBoard, TopShelfGame, TopShelfPeriod, TopShelfView } from "@scripta/shared";
import type { TournamentShelfFacts } from "../arena/service.js";
import type { CatalogWorkPage } from "../books/index.js";
import type { QuizShelfFacts } from "../quizzes/service.js";
import type { TierlistShelfFacts } from "../tierlists/service.js";
import type { EngagementRepository, GameRef } from "./domain/ports.js";
import { buildDiscoverItems, type CommunityDeps, type DiscoverEntry } from "./service.js";
import { rankTopShelf, topShelfMonthStart, type Ranked } from "./topShelf.js";

export interface TopShelfDeps {
  tierlistFacts(since: string | null): TierlistShelfFacts[];
  tournamentFacts(since: string | null): TournamentShelfFacts[];
  quizFacts(since: string | null): QuizShelfFacts[];
  canonicalWorks(ids: string[]): Map<string, string>;
  catalogGenres(workIds: string[]): Map<string, { genres: string[] }>;
  getWorkPage(id: string): CatalogWorkPage | undefined;
}

export type TopShelfQuery = { period: TopShelfPeriod; genre: string | null; view?: TopShelfView };

export interface TopShelfService {
  getTopShelf(query: TopShelfQuery): TopShelf;
}

type DiscoverDeps = Pick<CommunityDeps, "repo" | "tierlists" | "tournaments" | "quizzes" | "resolveProfiles" | "readerGlyphFor">;

const CACHE_MS = 60_000;
const PODIUM = 3;
const BOARD_PREVIEW = 1;
const FULL_BOARD = 10;

export function createTopShelfService(deps: { engagementRepo: Pick<EngagementRepository, "gameEngagement">; community: DiscoverDeps; shelf: TopShelfDeps; now: () => number }): TopShelfService {
  const { engagementRepo, community, shelf, now } = deps;
  const cache = new Map<string, { at: number; value: TopShelf }>();

  const compute = ({ period, genre, view }: TopShelfQuery): TopShelf => {
    const since = period === "month" ? topShelfMonthStart(new Date(now())) : null;
    const tierlists = shelf.tierlistFacts(since);
    const tournaments = shelf.tournamentFacts(since);
    const quizzes = shelf.quizFacts(since);
    const refs: GameRef[] = [
      ...tierlists.map((f) => ({ kind: "tierlist" as const, id: f.id })),
      ...tournaments.map((f) => ({ kind: "tournament" as const, id: f.id })),
      ...quizzes.map((f) => ({ kind: "quiz" as const, id: f.id })),
    ];
    const ownerIds = [...new Set([...tierlists, ...tournaments, ...quizzes].map((f) => f.ownerUserId))];
    const workIds = new Set<string>();
    for (const f of [...tierlists, ...tournaments, ...quizzes]) for (const id of f.workIds) workIds.add(id);
    for (const f of tierlists) for (const p of f.placements) workIds.add(p.workId);
    for (const f of tournaments) if (f.champion) workIds.add(f.champion.workId);
    const canonical = shelf.canonicalWorks([...workIds]);
    const ranked = rankTopShelf(
      {
        tierlists,
        tournaments,
        quizzes,
        engagement: engagementRepo.gameEngagement(refs, since),
        visibleOwners: new Set(community.resolveProfiles(ownerIds).keys()),
        canonical,
        genres: shelf.catalogGenres([...new Set(canonical.values())]),
      },
      { since, genre },
    );

    const sizeOf = (board: TopShelfBoard) => (view === undefined ? (board === "champions" ? PODIUM : BOARD_PREVIEW) : FULL_BOARD);
    const picked: Array<[TopShelfBoard, Ranked[]]> = [];
    if (view === undefined) for (const [board, list] of Object.entries(ranked.boards) as Array<[TopShelfBoard, Ranked[]]>) picked.push([board, list.slice(0, sizeOf(board))]);
    else if (view !== "games") picked.push([view, (ranked.boards[view] ?? []).slice(0, FULL_BOARD)]);
    const genreChampions = view === undefined ? ranked.genreChampions : [];

    const shownWorks = new Set<string>([...picked.flatMap(([, list]) => list.map((r) => r.workId)), ...genreChampions.map((g) => g.entry.workId)]);
    const cards = new Map<string, Omit<TopShelfBook, "value">>();
    for (const id of shownWorks) {
      const page = shelf.getWorkPage(id);
      if (page) cards.set(id, { workId: id, title: page.title, author: page.author, coverUrl: page.editions.find((e) => e.coverUrl)?.coverUrl ?? null });
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
      const key = JSON.stringify([query.period, query.genre, query.view ?? null]);
      const at = now();
      const hit = cache.get(key);
      if (hit && at - hit.at < CACHE_MS) return hit.value;
      const value = compute(query);
      for (const [k, entry] of cache) if (at - entry.at >= CACHE_MS) cache.delete(k);
      cache.set(key, { at, value });
      return value;
    },
  };
}
