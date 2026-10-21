import type { TopShelfRecap, TopShelfRecapCard, TopShelfRecapIndex } from "@scripta/shared";
import type { DiscoverItem } from "@scripta/shared/community";
import type { RecapRepository } from "./adapters/sqlite/sqliteRecapRepository.js";
import type { GameRef } from "./domain/ports.js";
import { buildDiscoverItems } from "./service.js";
import { addMonths, lisbonDay, lisbonMonth, lisbonMonthStart, type ShelfInput } from "./topShelf.js";
import { freezeRecap } from "./topShelfRecap.js";
import { workCard, type DiscoverDeps, type ShelfGatherer, type TopShelfDeps } from "./topShelfService.js";

const ANNOUNCE_DAYS = 7;

export interface TopShelfRecapService {
  freezeMonth(month: string): void;
  freezeDue(): void;
  getIndex(): TopShelfRecapIndex;
  getRecap(month: string): TopShelfRecap | null;
}

type LiveGame = { ref: GameRef; ownerUserId: string; promoted: boolean; createdAt: string; open: boolean; workIds: string[] };

function liveGames(live: ShelfInput): Map<string, LiveGame> {
  const games = new Map<string, LiveGame>();
  for (const f of live.tierlists) games.set(`tierlist:${f.id}`, { ref: { kind: "tierlist", id: f.id }, ownerUserId: f.ownerUserId, promoted: f.promoted, createdAt: f.createdAt, open: f.open, workIds: f.workIds });
  for (const f of live.tournaments) games.set(`tournament:${f.id}`, { ref: { kind: "tournament", id: f.id }, ownerUserId: f.ownerUserId, promoted: false, createdAt: f.createdAt, open: f.open, workIds: f.workIds });
  for (const f of live.quizzes) games.set(`quiz:${f.id}`, { ref: { kind: "quiz", id: f.id }, ownerUserId: f.ownerUserId, promoted: false, createdAt: f.createdAt, open: f.open, workIds: f.workIds });
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
    getRecap(month) {
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
      return { month, cards };
    },
  };
}
