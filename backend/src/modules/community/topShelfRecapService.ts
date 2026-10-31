import type { TopShelfRecap, TopShelfRecapCard, TopShelfRecapIndex } from "@scripta/shared";
import type { DiscoverItem } from "@scripta/shared/community";
import type { RecapRepository } from "./adapters/sqlite/sqliteRecapRepository.js";
import type { GameRef } from "./domain/ports.js";
import { createVisibility } from "./domain/visibility.js";
import { buildDiscoverItems } from "./service.js";
import { addMonths, lisbonDay, lisbonMonth, lisbonMonthStart, type ShelfInput } from "./topShelf.js";
import { freezeRecap } from "./topShelfRecap.js";
import { workCard, type DiscoverDeps, type ShelfGatherer, type TopShelfDeps } from "./topShelfService.js";

const ANNOUNCE_DAYS = 7;

export interface TopShelfRecapService {
  freezeMonth(month: string): void;
  freezeDue(): void;
  getIndex(): TopShelfRecapIndex;
  getRecap(month: string, options?: { daily?: boolean }): TopShelfRecap | null;
}

type LiveGame = { ref: GameRef; ownerUserId: string; promoted: boolean; createdAt: string; open: boolean; workIds: string[] };

function liveGames(live: ShelfInput): Map<string, LiveGame> {
  const games = new Map<string, LiveGame>();
  for (const f of live.games) games.set(`${f.kind}:${f.id}`, { ref: { kind: f.kind, id: f.id }, ownerUserId: f.ownerUserId, promoted: f.promoted, createdAt: f.createdAt, open: f.open, workIds: f.workIds });
  return games;
}

export function createTopShelfRecapService(deps: { repo: RecapRepository; gatherer: ShelfGatherer; community: DiscoverDeps; shelf: TopShelfDeps; now: () => number }): TopShelfRecapService {
  const { repo, gatherer, community, shelf, now } = deps;

  const freezeMonth = (month: string): void => {
    const range = { since: lisbonMonthStart(month), until: lisbonMonthStart(addMonths(month, 1)) };
    repo.put(month, freezeRecap(gatherer.gather(range.since, range.until), range), new Date(now()).toISOString());
  };

  return {
    freezeMonth,
    freezeDue() {
      const last = addMonths(lisbonMonth(new Date(now())), -1);
      const newest = repo.newest();
      if (newest === null) return freezeMonth(last);
      for (let month = addMonths(newest, 1); month <= last; month = addMonths(month, 1)) freezeMonth(month);
    },
    getIndex() {
      const at = new Date(now());
      const months = repo.months();
      const currentMonth = lisbonMonth(at);
      return { months, currentMonth, announce: months[0] === addMonths(currentMonth, -1) && lisbonDay(at) <= ANNOUNCE_DAYS };
    },
    getRecap(month, options = {}) {
      const data = repo.get(month);
      if (!data) return null;
      const live = gatherer.cached(null);
      const games = liveGames(live);
      const visible = (g: LiveGame) => g.promoted || live.visibleOwners.has(g.ownerUserId);
      const entryOf = (g: LiveGame) => ({ kind: g.ref.kind, id: g.ref.id, userId: g.ownerUserId, promoted: g.promoted, createdAt: g.createdAt });
      const canon = (id: string) => live.canonical.get(id) ?? id;

      const linked = data.books.map((b) => b.candidates.map((ref) => games.get(`${ref.kind}:${ref.id}`)).find((g) => g && visible(g) && g.open && g.workIds.some((id) => canon(id) === canon(b.workId))));
      const hot = data.hottest ? games.get(`${data.hottest.ref.kind}:${data.hottest.ref.id}`) : undefined;
      const hottest = data.hottest && hot && visible(hot) ? { facts: data.hottest, game: hot } : null;

      const wanted = [...linked.flatMap((g) => (g ? [g] : [])), ...(hottest ? [hottest.game] : [])];
      const items = new Map<string, DiscoverItem>(buildDiscoverItems(community, wanted.map(entryOf)).map((item) => [`${item.content.kind}:${item.content.id}`, item]));
      const itemOf = (g: LiveGame | undefined) => (g ? items.get(`${g.ref.kind}:${g.ref.id}`) ?? null : null);

      const cards: TopShelfRecapCard[] = [{ kind: "summary", ...data.summary }];
      data.books.forEach((b, i) => {
        const card = workCard(shelf, b.workId) ?? workCard(shelf, canon(b.workId));
        if (card) cards.push({ kind: "book", board: b.board, book: { ...card, value: b.value }, game: itemOf(linked[i]) });
      });
      if (hottest) {
        const item = itemOf(hottest.game);
        if (item) cards.push({ kind: "hottestGame", game: { item, likes: hottest.facts.likes, votes: hottest.facts.votes, comments: hottest.facts.comments }, open: hottest.game.open });
      }
      const daily = options.daily ? shelf.dailyChapterMonth?.(month) : null;
      if (daily?.players) {
        const standings = createVisibility(community.repo, null).standings(daily.perfect.map((entry) => entry.userId));
        const listed = daily.perfect.filter((entry) => standings.get(entry.userId)?.published);
        const profiles = community.resolveProfiles(listed.map((entry) => entry.userId));
        const topPlayers = listed.flatMap((entry) => { const profile = profiles.get(entry.userId); return profile ? [{ username: profile.username, perfect: entry.perfect }] : []; }).slice(0, 3);
        cards.push({ kind: "dailyChapter", players: daily.players, hardest: daily.hardest, mostMissed: daily.mostMissed, topPlayers });
      }
      return { month, cards };
    },
  };
}
