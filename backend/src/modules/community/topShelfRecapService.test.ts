import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { TierlistShelfFacts } from "../tierlists/service.js";
import { createRecapRepository } from "./adapters/sqlite/sqliteRecapRepository.js";
import type { RecapData } from "./topShelfRecap.js";
import type { ShelfInput } from "./topShelf.js";
import { createTopShelfRecapService } from "./topShelfRecapService.js";
import type { ShelfGatherer, TopShelfDeps } from "./topShelfService.js";

process.env.TZ = "America/Sao_Paulo";

const tierlist = (id: string, over: Partial<TierlistShelfFacts> = {}): TierlistShelfFacts => ({ id, ownerUserId: "u1", open: true, promoted: false, createdAt: "2026-10-05T00:00:00.000Z", voters: 5, votesSince: 3, workIds: ["w1"], placements: [], ...over });
const input = (over: Partial<ShelfInput> = {}): ShelfInput => ({ tierlists: [], tournaments: [], quizzes: [], engagement: new Map(), visibleOwners: new Set(["u1"]), canonical: new Map(), genres: new Map(), ...over });

function setup(now = "2026-10-21T10:00:00Z") {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./adapters/sqlite/schema.sql", import.meta.url), "utf8"));
  const repo = createRecapRepository(db);
  const state = { live: input(), gathered: [] as Array<[string | null, string | null]>, gatherInput: input({ quizzes: [{ id: "q", ownerUserId: "u1", open: true, createdAt: "2026-09-10T00:00:00.000Z", voters: 5, votesSince: 2, workIds: ["w1"] }] }), now: Date.parse(now) };
  const gatherer: ShelfGatherer = {
    gather: (since, until) => { state.gathered.push([since, until]); return state.gatherInput; },
    cached: () => state.live,
  };
  const shelf = { getWorkPage: (id: string) => (id === "gone" ? undefined : { id, title: `Title ${id}`, author: "A", editions: [{ coverUrl: `https://cdn.test/${id}.jpg` }] }) } as unknown as TopShelfDeps;
  const community = {
    repo: { getProfileRow: () => undefined, getFeedSettings: () => undefined },
    tierlists: { getPublishedMany: (ids: string[]) => ids.map((id) => ({ id, ownerUserId: "u1", createdAt: "2026-10-05T00:00:00.000Z", voteCode: `c-${id}`, name: `List ${id}`, poolSize: 4, ballotCount: 5, eligibleVoteCount: 5, promotedAt: null, votingOpen: true, covers: [] })), votedAmong: () => [] },
    tournaments: { getPublishedMany: () => [], votedAmong: () => [] },
    quizzes: { getPublishedMany: () => [], votedAmong: () => [] },
    resolveProfiles: (ids: string[]) => new Map(ids.map((id) => [id, { username: `user-${id}`, avatarUrl: null }])),
    readerGlyphFor: () => null,
  } as never;
  const service = createTopShelfRecapService({ repo, gatherer, community, shelf, now: () => state.now });
  return { service, repo, state };
}

const data = (over: Partial<RecapData> = {}): RecapData => ({
  summary: { gamesPublished: 1, votesCast: 3, booksInPlay: 1 },
  books: [{ board: "champions", workId: "w1", value: 4, candidates: [{ kind: "tierlist", id: "a" }, { kind: "tierlist", id: "b" }] }],
  hottest: { ref: { kind: "tierlist", id: "a" }, likes: 1, votes: 3, comments: 0 },
  ...over,
});

test("freezeDue freezes only last month when empty", () => {
  const { service, repo, state } = setup();
  service.freezeDue();
  assert.deepEqual(state.gathered, [["2026-08-31T23:00:00.000Z", "2026-09-30T23:00:00.000Z"]]);
  assert.equal(repo.newest(), "2026-09");
});

test("freezeDue fills every missing month and skips empty ones in the list", () => {
  const { service, repo, state } = setup();
  repo.put("2026-06", data(), "x");
  state.gatherInput = input();
  service.freezeDue();
  assert.equal(state.gathered.length, 3);
  assert.equal(repo.newest(), "2026-09");
  assert.deepEqual(repo.months(), ["2026-06"]);
  service.freezeDue();
  assert.equal(state.gathered.length, 3);
});

test("freezeMonth never overwrites a frozen month", () => {
  const { service, repo } = setup();
  repo.put("2026-09", data(), "x");
  service.freezeMonth("2026-09");
  assert.deepEqual(repo.get("2026-09"), data());
});

test("getRecap resolves links live and drops a hidden hottest game", () => {
  const { service, repo, state } = setup();
  repo.put("2026-09", data(), "x");
  state.live = input({ tierlists: [tierlist("a", { open: false }), tierlist("b")] });
  const open = service.getRecap("2026-09");
  assert.deepEqual(open?.cards.map((c) => c.kind), ["summary", "book", "hottestGame"]);
  const book = open?.cards[1];
  assert.equal(book?.kind === "book" && book.game?.content.id, "b");
  assert.equal(book?.kind === "book" && book.book.coverUrl, "https://cdn.test/w1.jpg");
  const hot = open?.cards[2];
  assert.equal(hot?.kind === "hottestGame" && hot.open, false);

  state.live = input({ tierlists: [tierlist("a", { open: false }), tierlist("b", { open: false })] });
  const closed = service.getRecap("2026-09")?.cards[1];
  assert.equal(closed?.kind === "book" && closed.game, null);

  state.live = input({ tierlists: [tierlist("a", { ownerUserId: "x" }), tierlist("b", { workIds: ["other"] })], visibleOwners: new Set(["u1"]) });
  const hidden = service.getRecap("2026-09");
  assert.deepEqual(hidden?.cards.map((c) => c.kind), ["summary", "book"]);
  const noLink = hidden?.cards[1];
  assert.equal(noLink?.kind === "book" && noLink.game, null);
});

test("getRecap links a card whose frozen work was merged into another", () => {
  const { service, repo, state } = setup();
  repo.put("2026-09", data({ books: [{ board: "champions", workId: "w-old", value: 4, candidates: [{ kind: "tierlist", id: "a" }] }] }), "x");
  state.live = input({ tierlists: [tierlist("a", { workIds: ["w-new"] })], canonical: new Map([["w-old", "w-new"]]) });
  const book = service.getRecap("2026-09")?.cards[1];
  assert.equal(book?.kind === "book" && book.game?.content.id, "a");
});

test("getRecap returns null for an empty month", () => {
  const { service, repo } = setup();
  repo.put("2026-09", data({ books: [], hottest: null }), "x");
  assert.equal(service.getRecap("2026-09"), null);
  assert.equal(service.getRecap("2026-10"), null);
});

test("getIndex announces last month's recap only on Lisbon days 1-7", () => {
  const early = setup("2026-08-31T23:30:00Z");
  early.repo.put("2026-08", data(), "x");
  assert.deepEqual(early.service.getIndex(), { months: ["2026-08"], currentMonth: "2026-09", announce: true });
  const late = setup("2026-11-08T12:00:00Z");
  late.repo.put("2026-10", data(), "x");
  assert.equal(late.service.getIndex().announce, false);
  const stale = setup("2026-11-03T12:00:00Z");
  stale.repo.put("2026-08", data(), "x");
  assert.equal(stale.service.getIndex().announce, false);
});
