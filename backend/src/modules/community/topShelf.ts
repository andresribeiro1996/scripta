import { tierPosition, type TopShelfBoard } from "@scripta/shared";
import type { TournamentShelfFacts } from "../arena/service.js";
import type { QuizShelfFacts } from "../quizzes/service.js";
import type { TierlistShelfFacts } from "../tierlists/service.js";
import type { GameRef } from "./domain/ports.js";

export const TOP_SHELF_MIN_VOTERS = 5;
export const HIGHEST_TIER_MIN_LISTS = 3;
const TITLE_POINTS = 3;

const lisbonParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" });

function lisbonWallClock(at: number): { year: number; month: number; day: number; wallAsUtc: number } {
  const p: Record<string, number> = Object.fromEntries(lisbonParts.formatToParts(new Date(at)).map((x) => [x.type, Number(x.value)]));
  const [year, month, day, hour, minute, second] = ["year", "month", "day", "hour", "minute", "second"].map((k) => p[k] as number);
  return { year: year as number, month: month as number, day: day as number, wallAsUtc: Date.UTC(year as number, (month as number) - 1, day, hour, minute, second) };
}

export function lisbonMonth(at: Date): string {
  const { year, month } = lisbonWallClock(at.getTime());
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function lisbonDay(at: Date): number {
  return lisbonWallClock(at.getTime()).day;
}

export function lisbonMonthStart(month: string): string {
  const [year, m] = month.split("-").map(Number) as [number, number];
  const guess = Date.UTC(year, m - 1, 1);
  const offset = lisbonWallClock(guess).wallAsUtc - guess;
  return new Date(guess - offset).toISOString();
}

export function addMonths(month: string, n: number): string {
  const [year, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(year, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function topShelfMonthStart(now: Date): string {
  return lisbonMonthStart(lisbonMonth(now));
}

export type ShelfInput = {
  tierlists: TierlistShelfFacts[];
  tournaments: TournamentShelfFacts[];
  quizzes: QuizShelfFacts[];
  engagement: Map<string, { publishedAt: string; likes: number; comments: number }>;
  visibleOwners: Set<string>;
  canonical: Map<string, string>;
  genres: Map<string, { genres: string[] }>;
};

export type Ranked = { workId: string; value: number };

type Game = {
  ref: GameRef;
  ownerUserId: string;
  promoted: boolean;
  createdAt: string;
  voters: number;
  votesSince: number;
  works: Set<string>;
  publishedAt: number;
};

type Tally = { titles: number; appearances: number; latest: number };

export function rankTopShelf(input: ShelfInput, opts: { since: string | null; until?: string | null; genre: string | null }) {
  const since = opts.since === null ? null : Date.parse(opts.since);
  const until = opts.until == null ? null : Date.parse(opts.until);
  const inPeriod = (at: number) => (since === null || at >= since) && (until === null || at < until);
  const canon = (id: string) => input.canonical.get(id) ?? id;
  const genresOf = (workId: string) => input.genres.get(workId)?.genres ?? [];

  const build = (kind: GameRef["kind"], f: { id: string; ownerUserId: string; createdAt: string; voters: number; votesSince: number; workIds: string[] }, promoted: boolean): Game => ({
    ref: { kind, id: f.id },
    ownerUserId: f.ownerUserId,
    promoted,
    createdAt: f.createdAt,
    voters: f.voters,
    votesSince: f.votesSince,
    works: new Set(f.workIds.map(canon)),
    publishedAt: Date.parse(input.engagement.get(`${kind}:${f.id}`)?.publishedAt ?? f.createdAt),
  });

  const tierlistGames = input.tierlists.map((t) => ({ facts: t, game: build("tierlist", t, t.promoted) }));
  const tournamentGames = input.tournaments.map((t) => ({ facts: t, game: build("tournament", t, false) }));
  const quizGames = input.quizzes.map((q) => ({ facts: q, game: build("quiz", q, false) }));
  const visible = (g: Game) => g.promoted || input.visibleOwners.has(g.ownerUserId);
  const qualifies = (g: Game) => visible(g) && g.voters >= TOP_SHELF_MIN_VOTERS;

  const tallies = new Map<string, Tally>();
  const tally = (workId: string) => {
    let t = tallies.get(workId);
    if (!t) tallies.set(workId, (t = { titles: 0, appearances: 0, latest: 0 }));
    return t;
  };
  const tiered = new Map<string, Tally>();
  const quizzed = new Map<string, Tally>();
  const bump = (map: Map<string, Tally>, workId: string, at: number) => {
    const t = map.get(workId) ?? { titles: 0, appearances: 0, latest: 0 };
    t.appearances += 1;
    t.latest = Math.max(t.latest, at);
    map.set(workId, t);
  };

  const firstSeen = new Map<string, number>();
  for (const { game } of [...tierlistGames, ...tournamentGames, ...quizGames]) {
    if (!visible(game)) continue;
    for (const w of game.works) firstSeen.set(w, Math.min(firstSeen.get(w) ?? Infinity, game.publishedAt));
  }

  const appear = (game: Game, map?: Map<string, Tally>) => {
    if (!qualifies(game) || !inPeriod(game.publishedAt)) return;
    for (const w of game.works) {
      const t = tally(w);
      t.appearances += 1;
      t.latest = Math.max(t.latest, game.publishedAt);
      if (map) bump(map, w, game.publishedAt);
    }
  };
  for (const { game } of tierlistGames) appear(game, tiered);
  for (const { game } of quizGames) appear(game, quizzed);
  for (const { game } of tournamentGames) appear(game);

  const crowned = new Map<string, Tally>();
  for (const { facts, game } of tournamentGames) {
    if (!qualifies(game) || !facts.champion) continue;
    const settledAt = Date.parse(facts.champion.settledAt);
    if (!inPeriod(settledAt)) continue;
    const w = canon(facts.champion.workId);
    const t = tally(w);
    t.titles += 1;
    const c = crowned.get(w) ?? { titles: 0, appearances: 0, latest: 0 };
    c.titles += 1;
    c.latest = Math.max(c.latest, settledAt);
    crowned.set(w, c);
  }

  const order = (a: Ranked & Tally, b: Ranked & Tally) => b.value - a.value || b.titles - a.titles || b.latest - a.latest || (a.workId < b.workId ? -1 : a.workId > b.workId ? 1 : 0);
  const rank = (entries: Array<[string, number, Tally]>): Ranked[] =>
    entries
      .filter(([, value]) => value > 0)
      .map(([workId, value, t]) => ({ workId, value, ...t }))
      .sort(order)
      .map(({ workId, value }) => ({ workId, value }));

  const allBoards: Partial<Record<TopShelfBoard, Ranked[]>> = {
    champions: rank([...tallies].map(([w, t]) => [w, t.titles * TITLE_POINTS + t.appearances, t])),
    crowned: rank([...crowned].map(([w, t]) => [w, t.titles, t])),
    tiered: rank([...tiered].map(([w, t]) => [w, t.appearances, t])),
    quizzed: rank([...quizzed].map(([w, t]) => [w, t.appearances, t])),
  };

  const perList = new Map<string, number[]>();
  for (const { facts, game } of tierlistGames) {
    if (!qualifies(game)) continue;
    const positions = new Map<string, number[]>();
    for (const p of facts.placements) {
      if (!inPeriod(Date.parse(p.castAt))) continue;
      const pos = tierPosition(p);
      if (pos === null) continue;
      const w = canon(p.workId);
      const list = positions.get(w);
      if (list) list.push(pos);
      else positions.set(w, [pos]);
    }
    for (const [w, list] of positions) {
      const avg = list.reduce((a, b) => a + b, 0) / list.length;
      const lists = perList.get(w);
      if (lists) lists.push(avg);
      else perList.set(w, [avg]);
    }
  }
  allBoards.highestTier = [...perList]
    .filter(([, lists]) => lists.length >= HIGHEST_TIER_MIN_LISTS)
    .map(([workId, lists]) => ({ workId, value: lists.reduce((a, b) => a + b, 0) / lists.length, lists: lists.length }))
    .sort((a, b) => a.value - b.value || b.lists - a.lists || (a.workId < b.workId ? -1 : a.workId > b.workId ? 1 : 0))
    .map(({ workId, value }) => ({ workId, value }));

  if (since !== null) {
    allBoards.risingStar = rank(
      [...tallies]
        .filter(([w]) => inPeriod(firstSeen.get(w) ?? -Infinity))
        .map(([w, t]) => [w, t.appearances, t]),
    );
  }

  const inGenre = (genre: string) => (r: Ranked) => genresOf(r.workId).includes(genre);
  const championsBoard = allBoards.champions ?? [];
  const bestByGenre = new Map<string, Ranked>();
  for (const entry of championsBoard) {
    for (const genre of genresOf(entry.workId)) if (!bestByGenre.has(genre)) bestByGenre.set(genre, entry);
  }
  const genreChampions = [...bestByGenre]
    .map(([genre, entry]) => ({ genre, entry }))
    .sort((a, b) => b.entry.value - a.entry.value || (a.genre < b.genre ? -1 : a.genre > b.genre ? 1 : 0));

  const boards: Partial<Record<TopShelfBoard, Ranked[]>> = {};
  for (const [name, list] of Object.entries(allBoards) as Array<[TopShelfBoard, Ranked[]]>) boards[name] = opts.genre === null ? list : list.filter(inGenre(opts.genre));

  const visibleGames = [...tierlistGames, ...tournamentGames, ...quizGames]
    .map(({ game }) => game)
    .filter(visible)
    .map((g) => {
      const e = input.engagement.get(`${g.ref.kind}:${g.ref.id}`);
      return { ref: g.ref, works: g.works, publishedAt: g.publishedAt, ownerUserId: g.ownerUserId, promoted: g.promoted, createdAt: g.createdAt, likes: e?.likes ?? 0, votes: g.votesSince, comments: e?.comments ?? 0 };
    });
  const games = visibleGames
    .filter((g) => g.likes + g.votes + g.comments > 0)
    .sort((a, b) => b.likes + b.votes + b.comments - (a.likes + a.votes + a.comments) || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0) || (`${a.ref.kind}:${a.ref.id}` < `${b.ref.kind}:${b.ref.id}` ? -1 : 1));

  const championPoints = new Map(genreChampions.map((g) => [g.genre, g.entry.value]));
  const menu = new Set<string>();
  for (const list of Object.values(allBoards)) for (const r of list) for (const genre of genresOf(r.workId)) menu.add(genre);
  const genres = [...menu].sort((a, b) => (championPoints.get(b) ?? 0) - (championPoints.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0));

  return { boards, genres, genreChampions: opts.genre === null ? genreChampions : [], games, visibleGames };
}
