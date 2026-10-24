// backend/src/modules/tierlists/service.test.ts
//
// Exercises service.ts against a hand-written in-memory
// TierlistsRepository fake — no real SQLite database needed, same seam
// backend/README.md describes for every other module's service layer.

import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeWords, type PublicBookData, type TierDefinition } from "@scripta/shared";
import type { TierlistsRepository, TierlistWorks } from "./domain/ports.js";
import { createTierlistsPublicApi, createTierlistsService, type TierlistWriteOutcome } from "./service.js";
import type { TierlistRow, BallotRow, BallotTotals, HistogramCell, Placement } from "./domain/types.js";


function book(workId: string, patch: Partial<PublicBookData> = {}): PublicBookData {
  return { key: workId, workId, title: workId, author: "A", isbn: null, imageId: null, coverUrl: null, readStatus: null, ...patch };
}

function fakeWorks(options: { books?: PublicBookData[]; aliases?: Record<string, string> } = {}): TierlistWorks {
  const alias = (id: string) => options.aliases?.[id] ?? id;
  return {
    knownWorkIds: (ids) => ids.map(alias),
    canonicalByKey: (ids) => new Map([...ids].map(([key, id]) => [key, alias(id)])),
    publicBooksByWork: (_ownerUserId, workIds) => new Map(workIds.flatMap((id) => (options.books ? options.books.filter((entry) => entry.workId === id) : [book(id)]).map((entry) => [id, entry] as const)))
  };
}

function created(outcome: TierlistWriteOutcome) {
  assert.equal(outcome.ok, true);
  return outcome.ok ? outcome.tierlist : (undefined as never);
}

function createInMemoryRepo(): TierlistsRepository {
  const tierlists = new Map<string, TierlistRow>();
  const ballots = new Map<string, BallotRow>();
  const placements = new Map<string, Placement[]>();

  return {
    deleteUserData() {},
    listByUser(userId) {
      return [...tierlists.values()].filter((t) => t.owner_user_id === userId && !t.promoted_at);
    },
    getOwned(id, userId) {
      const t = tierlists.get(id);
      return t && t.owner_user_id === userId && !t.promoted_at ? t : undefined;
    },
    insert(row) {
      tierlists.set(row.id, { ...row });
    },
    update(id, userId, patch) {
      const existing = tierlists.get(id);
      if (!existing || existing.owner_user_id !== userId) return undefined;
      const merged: TierlistRow = { ...existing, ...patch, updated_at: new Date().toISOString() };
      tierlists.set(id, merged);
      return merged;
    },
    delete(id, userId) {
      const existing = tierlists.get(id);
      if (!existing || existing.owner_user_id !== userId || existing.promoted_at) return false;
      tierlists.delete(id);
      return true;
    },

    getByVoteCode(code) {
      return [...tierlists.values()].find((t) => t.vote_code === code);
    },

    publish(id, userId, data, access, code, publicBooks, ballot, ps) {
      const row = tierlists.get(id);
      if (!row || row.owner_user_id !== userId || row.vote_code || row.promoted_at) return undefined;
      const published = { ...row, data, vote_access: access, vote_code: code, voting_open: 1, public_books: publicBooks };
      tierlists.set(id, published);
      ballots.set(ballot.id, { ...ballot });
      placements.set(ballot.id, [...ps]);
      return published;
    },

    promote(id, at) {
      const row = tierlists.get(id)!;
      tierlists.set(id, { ...row, owner_user_id: "__app__", promoted_at: at, voting_open: 0 });
    },

    eligibleVoteCount(id, originUserId) {
      return [...ballots.values()].filter((b) => b.tierlist_id === id && b.voter_user_id && b.voter_user_id !== originUserId && (placements.get(b.id)?.length ?? 0) > 0).length;
    },

    setVoting(id, userId, patch) {
      const existing = tierlists.get(id);
      if (!existing || existing.owner_user_id !== userId) return undefined;
      const merged: TierlistRow = { ...existing, ...patch, updated_at: new Date().toISOString() };
      tierlists.set(id, merged);
      return merged;
    },

    listPublic(limit, offset) {
      return [...tierlists.values()]
        .filter((t) => t.vote_code !== null)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(offset, offset + limit);
    },

    getPublicById(id) {
      return [...tierlists.values()].find((t) => t.id === id && t.vote_code !== null);
    },

    listPublicByUser(ownerUserId) {
      return [...tierlists.values()]
        .filter((t) => t.origin_user_id === ownerUserId && t.vote_code !== null)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },

    listVotedByUser(voterUserId) {
      const lastVoteAt = new Map<string, string>();
      for (const b of ballots.values()) {
        if (b.voter_user_id !== voterUserId) continue;
        const previous = lastVoteAt.get(b.tierlist_id);
        if (!previous || b.updated_at > previous) lastVoteAt.set(b.tierlist_id, b.updated_at);
      }
      return [...lastVoteAt.entries()]
        .map(([id, at]) => ({ row: tierlists.get(id), at }))
        .filter((entry): entry is { row: TierlistRow; at: string } => entry.row !== undefined)
        .filter(({ row }) => row.origin_user_id !== voterUserId)
        .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
        .map(({ row }) => row);
    },

    discoverWindow(needle, limit) {
      return [...tierlists.values()]
        .filter((t) => t.vote_code !== null && normalizeWords(t.name).includes(needle))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, limit)
        .map((t) => ({ id: t.id, created_at: t.created_at, origin_user_id: t.origin_user_id, promoted_at: t.promoted_at }));
    },

    listPublicByIds(ids) {
      return [...tierlists.values()].filter((t) => t.vote_code !== null && ids.includes(t.id));
    },

    ballotTotalsFor(ids) {
      const totals = new Map<string, BallotTotals>();
      for (const id of ids) {
        const origin = tierlists.get(id)?.origin_user_id;
        const own = [...ballots.values()].filter((b) => b.tierlist_id === id);
        if (origin === undefined || own.length === 0) continue;
        const eligible = own.filter((b) => b.voter_user_id && b.voter_user_id !== origin && (placements.get(b.id)?.length ?? 0) > 0);
        totals.set(id, { ballots: own.length, eligible: eligible.length });
      }
      return totals;
    },

    votedAmong(voterUserId, ids) {
      return ids.filter((id) => {
        const row = tierlists.get(id);
        return row !== undefined && row.origin_user_id !== voterUserId && [...ballots.values()].some((b) => b.tierlist_id === id && b.voter_user_id === voterUserId);
      });
    },

    getBallotById(tierlistId, ballotId) {
      const b = ballots.get(ballotId);
      return b && b.tierlist_id === tierlistId ? b : undefined;
    },

    getBallotByVoter(tierlistId, voterUserId) {
      return [...ballots.values()].find((b) => b.tierlist_id === tierlistId && b.voter_user_id === voterUserId);
    },

    saveBallot(ballot, ps) {
      const clash = [...ballots.values()].find(
        (b) => b.tierlist_id === ballot.tierlist_id && b.voter_user_id !== null && b.voter_user_id === ballot.voter_user_id && b.id !== ballot.id
      );
      if (clash) throw new Error("UNIQUE constraint failed: tierlist_ballots.voter_user_id");
      ballots.set(ballot.id, { ...ballot });
      placements.set(ballot.id, [...ps]);
    },

    getPlacements(ballotId) {
      return [...(placements.get(ballotId) ?? [])];
    },

    histogram(tierlistId) {
      const counts = new Map<string, HistogramCell>();
      for (const ballot of ballots.values()) {
        if (ballot.tierlist_id !== tierlistId) continue;
        for (const p of placements.get(ballot.id) ?? []) {
          const key = JSON.stringify([p.workId, p.tierId]);
          const cell = counts.get(key) ?? { workId: p.workId, tierId: p.tierId, votes: 0 };
          cell.votes += 1;
          counts.set(key, cell);
        }
      }
      return [...counts.values()];
    },

    ballotCount(tierlistId) {
      return [...ballots.values()].filter((b) => b.tierlist_id === tierlistId).length;
    },

    ballotCountsByTierlist() {
      const counts = new Map<string, number>();
      for (const b of ballots.values()) counts.set(b.tierlist_id, (counts.get(b.tierlist_id) ?? 0) + 1);
      return counts;
    },

    listPublishedByWorks() {
      return [];
    },
    tierPlacements() {
      return [];
    },
    topShelfFacts() {
      return [];
    },
    listParticipation() {
      return [];
    },

    listRecentVoters() {
      return [];
    }
  };
}

function makeService() {
  return createTierlistsService(createInMemoryRepo(), fakeWorks());
}

test("a published ballot event captures actual ranked books from its frozen snapshot", () => {
  const ranking: unknown[] = [];
  const works = fakeWorks({ books: [book("w1", { title: "Dune", author: "Frank Herbert", coverUrl: "https://covers.test/dune.jpg" }), book("w2", { title: "Emma", author: "Jane Austen" })] });
  const service = createTierlistsService(createInMemoryRepo(), works, undefined, (_user, _id, _name, preview) => { ranking.push(preview); });
  const board = created(service.createTierlist("owner", { name: "Pool", data: { tiers: [{ id: "s", label: "S", color: "#c9482f", workIds: [] }, { id: "a", label: "A", color: "#f2aa20", workIds: [] }], pool: ["w1", "w2"] }, access: "members" }));
  assert.equal(service.submitBallot(board.voteCode!, [{ workId: "w2", tierId: "a" }], { kind: "user", userId: "reader" }).ok, true);
  assert.deepEqual(ranking, [[{ label: "A", color: "#f2aa20", books: [{ title: "Emma", coverUrl: null }] }]]);
});

test("createTierlist stores a tier list and getTierlist round-trips it", () => {
  const service = makeService();
  const made = created(service.createTierlist("u1", { name: "Favorites" }));
  assert.equal(made.name, "Favorites");
  const preset = (made.data as { tiers: Array<{ label: string; color: string }>; pool: string[] }).tiers;
  assert.deepEqual(
    preset.map((t) => t.label),
    ["S", "A", "B", "C", "D"]
  );
  assert.equal(preset[0]?.color, "#c9482f");
  assert.deepEqual((made.data as { pool: string[] }).pool, []);
  const fetched = service.getTierlist("u1", made.id);
  assert.deepEqual(fetched, made);
});

test("public creation uses one immutable resource and a book snapshot", () => {
  const service = makeService();
  const data = { tiers: [{ id: "s", label: "S", color: "#c9482f", workIds: [] }], pool: ["b1"] };
  const board = created(service.createTierlist("u1", { name: "Books", data, access: "anonymous" }));
  assert.ok(board.voteCode);
  assert.equal(service.listTierlists("u1").length, 1);
  assert.equal(service.getVotingBoard(board.voteCode!)?.publicBooks?.length, 1);
  assert.equal(service.getResults(board.id).ballotCount, 0);
  assert.equal(service.updateTierlist("u1", board.id, { name: "Changed" }).ok, false);
});

const oneTier = [{ id: "s", label: "S", color: "#c9482f", workIds: [] as string[] }];

test("a create with access but no board is invalid", () => {
  const service = makeService();
  assert.deepEqual(service.createTierlist("u1", { name: "X", access: "anonymous" }), { ok: false, reason: "invalid", error: "Choose books and tiers before publishing." });
  assert.equal(service.listTierlists("u1").length, 0);
});

test("a create with two tiers sharing an id is invalid", () => {
  const service = makeService();
  const tiers = [oneTier[0]!, { ...oneTier[0]!, label: "Again" }];
  assert.deepEqual(service.createTierlist("u1", { name: "X", data: { tiers, pool: [] } }), { ok: false, reason: "invalid", error: "Duplicate tier or book." });
});

test("a create with a book listed twice is invalid", () => {
  const service = makeService();
  assert.deepEqual(service.createTierlist("u1", { name: "X", data: { tiers: oneTier, pool: ["b1", "b1"] } }), { ok: false, reason: "invalid", error: "Duplicate tier or book." });
});

test("a public create needs every book in the pool and no tier filled", () => {
  const service = makeService();
  const error = "Public tier lists need an unranked book pool.";
  assert.deepEqual(service.createTierlist("u1", { name: "X", data: { tiers: oneTier, pool: [] }, access: "anonymous" }), { ok: false, reason: "invalid", error });
  assert.deepEqual(service.createTierlist("u1", { name: "X", data: { tiers: [{ ...oneTier[0]!, workIds: ["b1"] }], pool: ["b2"] }, access: "anonymous" }), { ok: false, reason: "invalid", error });
  assert.equal(service.listTierlists("u1").length, 0);
});

test("a public create whose book the library no longer holds is invalid", () => {
  const service = createTierlistsService(createInMemoryRepo(), fakeWorks({ books: [book("b1")] }));
  assert.deepEqual(service.createTierlist("u1", { name: "X", data: { tiers: oneTier, pool: ["b1", "b2"] }, access: "members" }), { ok: false, reason: "invalid", error: "A selected book is no longer in your library." });
  assert.equal(service.listTierlists("u1").length, 0);
});

test("a create with two editions of one work is a duplicate-work outcome with no title", () => {
  const service = createTierlistsService(createInMemoryRepo(), fakeWorks({ aliases: { e1: "w1", e2: "w1" } }));
  assert.deepEqual(service.createTierlist("u1", { name: "X", data: { tiers: oneTier, pool: ["e1", "e2"] } }), { ok: false, reason: "duplicate-work", title: null });
  assert.equal(service.listTierlists("u1").length, 0);
});

test("a create stores canonical work ids and snapshots the pool's public books in order", () => {
  const works = fakeWorks({ aliases: { e1: "w1", e2: "w2" }, books: [book("w2", { title: "Emma" }), book("w1", { title: "Dune" })] });
  const service = createTierlistsService(createInMemoryRepo(), works);
  const outcome = service.createTierlist("u1", { name: "X", data: { tiers: oneTier, pool: ["e2", "e1"] }, access: "anonymous" });
  assert.ok(outcome.ok);
  assert.deepEqual(outcome.data, { tiers: oneTier, pool: ["w2", "w1"] });
  assert.deepEqual(outcome.tierlist.data, outcome.data);
  const books = service.getVotingBoard(outcome.tierlist.voteCode!)?.publicBooks as Array<{ title: string }>;
  assert.deepEqual(books.map((entry) => entry.title), ["Emma", "Dune"]);
});

test("an update of a public or someone else's list is not-found, and a bad board is invalid", () => {
  const service = makeService();
  const mine = created(service.createTierlist("u1", { name: "Mine" }));
  const published = created(service.createTierlist("u1", { name: "Public", data: { tiers: oneTier, pool: ["b1"] }, access: "anonymous" }));
  const notFound = { ok: false, reason: "not-found", error: "No tier list with that id." };
  assert.deepEqual(service.updateTierlist("u2", mine.id, { data: { tiers: oneTier, pool: [] } }), notFound);
  assert.deepEqual(service.updateTierlist("u1", published.id, { data: { tiers: oneTier, pool: [] } }), notFound);
  assert.deepEqual(service.updateTierlist("u1", mine.id, { data: { tiers: oneTier, pool: ["b1", "b1"] } }), { ok: false, reason: "invalid", error: "Duplicate tier or book." });
  assert.deepEqual(service.getTierlist("u1", mine.id)?.data, mine.data);
});

test("an update with two editions of one work is a duplicate-work outcome and writes nothing", () => {
  const service = createTierlistsService(createInMemoryRepo(), fakeWorks({ aliases: { e1: "w1", e2: "w1" } }));
  const mine = created(service.createTierlist("u1", { name: "Mine" }));
  assert.deepEqual(service.updateTierlist("u1", mine.id, { name: "Renamed", data: { tiers: oneTier, pool: ["e1", "e2"] } }), { ok: false, reason: "duplicate-work", title: null });
  assert.equal(service.getTierlist("u1", mine.id)?.name, "Mine");
});

test("a name-only update returns the stored board in canonical ids", () => {
  const repo = createInMemoryRepo();
  const service = createTierlistsService(repo, fakeWorks({ aliases: { e1: "w1" } }));
  const mine = created(service.createTierlist("u1", { name: "Mine" }));
  repo.update(mine.id, "u1", { data: JSON.stringify({ tiers: oneTier, pool: ["e1"] }) });
  const updated = service.updateTierlist("u1", mine.id, { name: "Renamed" });
  assert.ok(updated.ok);
  assert.deepEqual(updated.data, { tiers: oneTier, pool: ["w1"] });
  assert.equal(updated.tierlist.name, "Renamed");
});

test("a name-only update writes nothing when the port throws", () => {
  const failing: TierlistWorks = { ...fakeWorks(), canonicalByKey: () => { throw new Error("catalog down"); } };
  const repo = createInMemoryRepo();
  const mine = created(createTierlistsService(repo, fakeWorks()).createTierlist("u1", { name: "Mine" }));
  const service = createTierlistsService(repo, failing);
  assert.throws(() => service.updateTierlist("u1", mine.id, { name: "Renamed" }), /catalog down/);
  assert.equal(service.getTierlist("u1", mine.id)?.name, "Mine");
});

test("open voting snapshots the board's books from the owner's library", () => {
  const works = fakeWorks({ books: [book("w2", { title: "Emma" }), book("w1", { title: "Dune" })] });
  const repo = createInMemoryRepo();
  const service = createTierlistsService(repo, works);
  const mine = created(service.createTierlist("u1", { name: "Mine" }));
  repo.update(mine.id, "u1", { data: JSON.stringify({ tiers: [{ ...oneTier[0]!, workIds: ["w1"] }], pool: ["w2"] }) });
  const opened = service.openVoting("u1", mine.id, "anonymous");
  assert.ok(opened);
  assert.deepEqual([...opened.known], [["w1", "w1"], ["w2", "w2"]]);
  const books = service.getVotingBoard(opened.tierlist.voteCode!)?.publicBooks as Array<{ title: string }>;
  assert.deepEqual(books.map((entry) => entry.title), ["Emma", "Dune"]);
});

test("listTierlists is scoped per user", () => {
  const service = makeService();
  const a = created(service.createTierlist("u1", { name: "A" }));
  const b = created(service.createTierlist("u1", { name: "B" }));
  created(service.createTierlist("u2", { name: "Theirs" }));
  const listed = service.listTierlists("u1");
  assert.equal(listed.length, 2);
  assert.ok(listed.some((t) => t.id === a.id));
  assert.ok(listed.some((t) => t.id === b.id));
});

test("updateTierlist renames without touching data", () => {
  const service = makeService();
  const t = created(service.createTierlist("u1", { name: "Old" }));
  const updated = service.updateTierlist("u1", t.id, { name: "New" });
  assert.ok(updated.ok);
  assert.equal(updated.tierlist.name, "New");
  assert.equal(updated.data.tiers.length, 5);
});

test("updateTierlist replaces data without touching name", () => {
  const service = makeService();
  const t = created(service.createTierlist("u1", { name: "Keep" }));
  const next = { tiers: [{ id: "s", label: "S", color: "#ff7f7f", workIds: ["b1"] }], pool: ["b2"] };
  const updated = service.updateTierlist("u1", t.id, { data: next });
  assert.ok(updated.ok);
  assert.equal(updated.tierlist.name, "Keep");
  assert.deepEqual(updated.data, next);
  assert.deepEqual(service.getTierlist("u1", t.id)?.data, next);
});

test("updateTierlist is not-found for an unowned tier list", () => {
  const service = makeService();
  const theirs = created(service.createTierlist("u2", { name: "Theirs" }));
  assert.deepEqual(service.updateTierlist("u1", theirs.id, { name: "Mine" }), { ok: false, reason: "not-found", error: "No tier list with that id." });
});

test("deleteTierlist returns false for an unowned tier list", () => {
  const service = makeService();
  const theirs = created(service.createTierlist("u2", { name: "Theirs" }));
  assert.equal(service.deleteTierlist("u1", theirs.id), false);
});

test("a deleted tier list is no longer returned by getTierlist", () => {
  const service = makeService();
  const t = created(service.createTierlist("u1", { name: "Doomed" }));
  assert.equal(service.deleteTierlist("u1", t.id), true);
  assert.equal(service.getTierlist("u1", t.id), undefined);
});

test("a tier list stored before the tiers/pool shape existed normalizes to empty arrays", () => {
  const repo = createInMemoryRepo();
  const legacy = {
    id: "00000000-0000-4000-8000-000000000001",
    owner_user_id: "u1",
    name: "Legacy",
    data: "{}",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  } as TierlistRow;
  repo.insert(legacy);
  const service = createTierlistsService(repo, fakeWorks());
  assert.deepEqual(service.getTierlist("u1", legacy.id)?.data, { tiers: [], pool: [] });
});

test("createTierlistsPublicApi resolves the raw document and defaults missing arrays", () => {
  const service = makeService();
  const api = createTierlistsPublicApi(service, fakeWorks());

  const fresh = created(service.createTierlist("u1", { name: "Fresh" }));
  const freshData = api.getTierlistData("u1", fresh.id);
  assert.equal(freshData?.name, "Fresh");
  assert.equal(freshData?.tiers.length, 5);
  assert.deepEqual(freshData?.pool, []);

  const doc = { tiers: [{ id: "s", label: "S", color: "#ff7f7f", workIds: ["b1"] }], pool: ["b2"] };
  const ranked = created(service.createTierlist("u1", { name: "Ranked" }));
  service.updateTierlist("u1", ranked.id, { data: doc });
  assert.deepEqual(api.getTierlistData("u1", ranked.id), { name: "Ranked", tiers: doc.tiers, pool: doc.pool });

  assert.equal(api.getTierlistData("u2", ranked.id), undefined);
  assert.equal(api.getTierlistData("u1", "00000000-0000-4000-8000-000000000000"), undefined);
});

test("openVoting publishes the same tier list and freezes it", () => {
  const service = makeService();
  const original = created(service.createTierlist("u1", { name: "Fantasy" }));
  const tiers = (original.data as { tiers: TierDefinition[] }).tiers;
  service.updateTierlist("u1", original.id, {
    data: { tiers: tiers.map((t, i) => ({ ...t, workIds: i === 0 ? ["b1"] : [] })), pool: ["b2"] }
  });

  const copy = service.openVoting("u1", original.id, "anonymous")?.tierlist;

  assert.ok(copy);
  assert.equal(copy.id, original.id);
  assert.equal(copy.name, "Fantasy");
  assert.equal(copy.sourceTierlistId, null);
  assert.equal(copy.votingOpen, true);
  assert.equal(copy.voteAccess, "anonymous");
  assert.ok(copy.voteCode && copy.voteCode.length >= 6);

  assert.equal(service.getTierlist("u1", original.id)?.voteCode, copy.voteCode);
});

test("publishing freezes the structure and keeps the whole pool", () => {
  const service = makeService();
  const original = created(service.createTierlist("u1", { name: "Fantasy" }));
  const tiers = (original.data as { tiers: TierDefinition[] }).tiers;
  service.updateTierlist("u1", original.id, {
    data: { tiers: tiers.map((t, i) => ({ ...t, workIds: i === 0 ? ["b1"] : [] })), pool: ["b2"] }
  });

  const copy = service.openVoting("u1", original.id, "anonymous")?.tierlist;
  const data = copy?.data as { tiers: Array<{ id: string; workIds: string[] }>; pool: string[] };

  assert.deepEqual(data.tiers.map((t) => t.workIds), [[], [], [], [], []]);
  assert.deepEqual(data.tiers.map((t) => t.id), tiers.map((t) => t.id));
  assert.deepEqual([...data.pool].sort(), ["b1", "b2"]);
});

test("openVoting seeds the owner's ranking as the first ballot", () => {
  const service = makeService();
  const original = created(service.createTierlist("u1", { name: "Fantasy" }));
  const tiers = (original.data as { tiers: TierDefinition[] }).tiers;
  const topTierId = tiers[0]!.id;
  service.updateTierlist("u1", original.id, {
    data: { tiers: tiers.map((t, i) => ({ ...t, workIds: i === 0 ? ["b1"] : [] })), pool: ["b2"] }
  });

  const copy = service.openVoting("u1", original.id, "anonymous")!.tierlist;
  const results = service.getResults(copy.id);

  assert.equal(results.ballotCount, 1);
  assert.equal(results.histogram.find((c) => c.workId === "b1")?.tierId, topTierId);
  assert.equal(results.histogram.find((c) => c.workId === "b2"), undefined);
});

test("openVoting returns undefined for an unowned tier list", () => {
  const service = makeService();
  const theirs = created(service.createTierlist("u2", { name: "Theirs" }));
  assert.equal(service.openVoting("u1", theirs.id, "anonymous"), undefined);
});

test("opening voting twice does not create another resource", () => {
  const service = makeService();
  const original = created(service.createTierlist("u1", { name: "Fantasy" }));
  const first = service.openVoting("u1", original.id, "anonymous")!.tierlist;
  assert.equal(service.openVoting("u1", original.id, "members"), undefined);
  assert.equal(service.getTierlist("u1", original.id)?.voteCode, first.voteCode);
});

test("a public tier list refuses data and name changes", () => {
  const service = makeService();
  const original = created(service.createTierlist("u1", { name: "Fantasy" }));
  const copy = service.openVoting("u1", original.id, "anonymous")!.tierlist;
  const frozen = copy.data;

  assert.equal(service.updateTierlist("u1", copy.id, { data: { tiers: [], pool: ["sneaky"] } }).ok, false);
  assert.deepEqual(service.getTierlist("u1", copy.id)?.data, frozen);

  assert.equal(service.updateTierlist("u1", copy.id, { name: "Renamed" }).ok, false);
});

test("published structure is immutable", () => {
  const service = makeService();
  const original = created(service.createTierlist("u1", { name: "Fantasy" }));
  service.openVoting("u1", original.id, "anonymous");
  const edited = service.updateTierlist("u1", original.id, { data: { tiers: [], pool: ["b9"] } });
  assert.equal(edited.ok, false);
});

test("setVotingState switches access and closes without losing ballots", () => {
  const service = makeService();
  const original = created(service.createTierlist("u1", { name: "Fantasy" }));
  const copy = service.openVoting("u1", original.id, "anonymous")!.tierlist;

  const tightened = service.setVotingState("u1", copy.id, { access: "members" });
  assert.equal(tightened?.voteAccess, "members");

  const closed = service.setVotingState("u1", copy.id, { open: false });
  assert.equal(closed?.votingOpen, false);
  assert.equal(closed?.voteCode, copy.voteCode);
  assert.equal(service.getResults(copy.id).ballotCount, 1);

  assert.equal(service.setVotingState("u2", copy.id, { open: true }), undefined);
});

function openPoll(service: ReturnType<typeof makeService>, access: "anonymous" | "members" = "anonymous") {
  const original = created(service.createTierlist("u1", { name: "Fantasy" }));
  const tiers = (original.data as { tiers: TierDefinition[] }).tiers;
  service.updateTierlist("u1", original.id, {
    data: { tiers: tiers.map((t) => ({ ...t, workIds: [] })), pool: ["b1", "b2"] }
  });
  const copy = service.openVoting("u1", original.id, access)!.tierlist;
  return { copy, code: copy.voteCode!, tierIds: tiers.map((t) => t.id) };
}

test("an anonymous ballot is created, then edited by its returned id", () => {
  const service = makeService();
  const { code, tierIds } = openPoll(service);

  const first = service.submitBallot(code, [{ workId: "b1", tierId: tierIds[0]! }], { kind: "anonymous", ballotId: null });
  assert.equal(first.ok, true);
  const ballotId = first.ok ? first.ballotId : "";

  const edit = service.submitBallot(code, [{ workId: "b1", tierId: tierIds[1]! }], { kind: "anonymous", ballotId });
  assert.equal(edit.ok, true);
  assert.equal(edit.ok && edit.ballotId, ballotId);

  const results = service.getResults(openPollIdFor(service, code));
  assert.equal(results.ballotCount, 2);
  assert.equal(results.histogram.find((c) => c.workId === "b1" && c.tierId === tierIds[1]!)?.votes, 1);
});

function openPollIdFor(service: ReturnType<typeof makeService>, code: string): string {
  return service.getVotingBoard(code)!.id;
}

test("a signed-in voter gets one ballot, edited in place across submissions", () => {
  const service = makeService();
  const { code, tierIds } = openPoll(service);

  const first = service.submitBallot(code, [{ workId: "b1", tierId: tierIds[0]! }], { kind: "user", userId: "u7" });
  const second = service.submitBallot(code, [{ workId: "b1", tierId: tierIds[2]! }], { kind: "user", userId: "u7" });

  assert.equal(first.ok && second.ok && first.ballotId === second.ballotId, true);
  const results = service.getResults(openPollIdFor(service, code));
  assert.equal(results.ballotCount, 2);
});

test("a signed-in voter's ballot is stored against their account id", () => {
  // The dedupe half of "signed in" — the partial unique index on
  // (tierlist_id, voter_user_id) can only do its job if the ballot row
  // actually carries the voter's id, which is what a caller sending no
  // Authorization header silently loses (every such voter resolves to
  // {kind: "anonymous"} in routes.ts's voterFor).
  const repo = createInMemoryRepo();
  const service = createTierlistsService(repo, fakeWorks());
  const { code, tierIds } = openPoll(service);
  const tierlistId = service.getVotingBoard(code)!.id;

  const outcome = service.submitBallot(code, [{ workId: "b1", tierId: tierIds[0]! }], { kind: "user", userId: "u7" });

  const stored = repo.getBallotByVoter(tierlistId, "u7");
  assert.equal(stored?.voter_user_id, "u7");
  assert.equal(outcome.ok && outcome.ballotId, stored?.id);
});

test("members-only refuses an anonymous ballot", () => {
  const service = makeService();
  const { code, tierIds } = openPoll(service, "members");
  const outcome = service.submitBallot(code, [{ workId: "b1", tierId: tierIds[0]! }], { kind: "anonymous", ballotId: null });
  assert.deepEqual(outcome, { ok: false, reason: "members-only" });
});

test("a closed poll refuses new ballots", () => {
  const service = makeService();
  const { copy, code, tierIds } = openPoll(service);
  service.setVotingState("u1", copy.id, { open: false });
  const outcome = service.submitBallot(code, [{ workId: "b1", tierId: tierIds[0]! }], { kind: "anonymous", ballotId: null });
  assert.deepEqual(outcome, { ok: false, reason: "closed" });
});

test("an unknown code is not found", () => {
  const service = makeService();
  assert.deepEqual(service.submitBallot("nosuch", [], { kind: "anonymous", ballotId: null }), { ok: false, reason: "not-found" });
});

test("placements outside the frozen structure are rejected", () => {
  const service = makeService();
  const { code, tierIds } = openPoll(service);

  assert.deepEqual(service.submitBallot(code, [{ workId: "nope", tierId: tierIds[0]! }], { kind: "anonymous", ballotId: null }), {
    ok: false,
    reason: "invalid"
  });
  assert.deepEqual(service.submitBallot(code, [{ workId: "b1", tierId: "nosuchtier" }], { kind: "anonymous", ballotId: null }), {
    ok: false,
    reason: "invalid"
  });
  assert.deepEqual(
    service.submitBallot(
      code,
      [
        { workId: "b1", tierId: tierIds[0]! },
        { workId: "b1", tierId: tierIds[1]! }
      ],
      { kind: "anonymous", ballotId: null }
    ),
    { ok: false, reason: "invalid" }
  );
});

test("an unranked book simply has no placement", () => {
  const service = makeService();
  const { code, tierIds } = openPoll(service);
  service.submitBallot(code, [{ workId: "b1", tierId: tierIds[0]! }], { kind: "anonymous", ballotId: null });
  const results = service.getResults(openPollIdFor(service, code));
  assert.equal(results.histogram.some((c) => c.workId === "b2"), false);
});

test("getBallot rehydrates an anonymous voter's placements", () => {
  const service = makeService();
  const { code, tierIds } = openPoll(service);
  const submitted = service.submitBallot(code, [{ workId: "b1", tierId: tierIds[0]! }], { kind: "anonymous", ballotId: null });
  const ballotId = submitted.ok ? submitted.ballotId : "";

  const fetched = service.getBallot(code, { kind: "anonymous", ballotId });
  assert.equal(fetched.ok, true);
  assert.deepEqual(fetched.ok && fetched.placements, [{ workId: "b1", tierId: tierIds[0]! }]);
});

test("getVotingBoard exposes structure and never the owner's placements", () => {
  const service = makeService();
  const { code, tierIds } = openPoll(service);
  const board = service.getVotingBoard(code)!;

  assert.equal(board.name, "Fantasy");
  assert.equal(board.votingOpen, true);
  assert.equal(board.access, "anonymous");
  assert.deepEqual([...board.pool].sort(), ["b1", "b2"]);
  assert.deepEqual(board.tiers.map((t) => t.id), tierIds);
  assert.equal(Object.keys(board.tiers[0]!).includes("workIds"), false);
  assert.equal(board.ballotCount, 1);
});

test("getVotingBoard still resolves once voting is closed", () => {
  const service = makeService();
  const { copy, code } = openPoll(service);
  service.setVotingState("u1", copy.id, { open: false });
  const board = service.getVotingBoard(code);
  assert.equal(board?.votingOpen, false);
  assert.equal(board?.ballotCount, 1);
});

test("getVotingBoard is undefined for an unknown code", () => {
  const service = makeService();
  assert.equal(service.getVotingBoard("nosuch"), undefined);
});

test("listPublicTierlists returns community copies only, newest first", () => {
  const service = makeService();
  created(service.createTierlist("u1", { name: "Private" }));
  const { code } = openPoll(service);

  const listed = service.listPublicTierlists(10, 0);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.voteCode, code);
  assert.equal(listed[0]?.poolSize, 2);
  assert.equal(listed[0]?.ballotCount, 1);
  assert.equal(listed[0]?.votingOpen, true);
});

test("openVoting emits exactly one publish event for the same tier list", () => {
  const emitted: Array<[string, string]> = [];
  const service = createTierlistsService(createInMemoryRepo(), fakeWorks(), (copyId, ownerUserId) => {
    emitted.push([copyId, ownerUserId]);
  });
  const original = created(service.createTierlist("u1", { name: "Fantasy" }));

  const copy = service.openVoting("u1", original.id, "anonymous")?.tierlist;

  assert.ok(copy);
  assert.deepEqual(emitted, [[copy.id, "u1"]]);
});

test("a first signed-in ballot emits voted_on once", () => {
  const emitted: Array<[string, string, string]> = [];
  const service = createTierlistsService(createInMemoryRepo(), fakeWorks(), undefined, (voterUserId, tierlistId, tierlistName) => {
    emitted.push([voterUserId, tierlistId, tierlistName]);
  });
  const { code, tierIds } = openPoll(service);
  const tierlistId = service.getVotingBoard(code)!.id;

  const outcome = service.submitBallot(
    code,
    [
      { workId: "b1", tierId: tierIds[0]! },
      { workId: "b2", tierId: tierIds[1]! }
    ],
    { kind: "user", userId: "u7" }
  );

  assert.equal(outcome.ok, true);
  assert.deepEqual(emitted, [["u7", tierlistId, "Fantasy"]]);
});

test("voted_on ranking skips empty top tiers and keeps the first three populated ones", () => {
  const rankings: Array<Array<{ label: string }>> = [];
  const service = createTierlistsService(createInMemoryRepo(), fakeWorks({ books: ["w1", "w2", "w3"].map((workId) => book(workId, { title: `Book ${workId}` })) }), undefined, (_voterUserId, _tierlistId, _tierlistName, ranking) => {
    rankings.push(ranking);
  });
  const tiers = ["S", "A", "B", "C", "D"].map((label) => ({ id: label.toLowerCase(), label, color: "#c9482f", workIds: [] }));
  const board = created(service.createTierlist("owner", { name: "Pool", data: { tiers, pool: ["w1", "w2", "w3"] }, access: "members" }));

  service.submitBallot(board.voteCode!, [{ workId: "w1", tierId: "b" }, { workId: "w2", tierId: "c" }, { workId: "w3", tierId: "d" }], { kind: "user", userId: "reader" });

  assert.deepEqual(rankings.map((ranking) => ranking.map((tier) => tier.label)), [["B", "C", "D"]]);
});

test("editing a signed-in ballot emits no second voted_on", () => {
  const emitted: Array<[string, string, string]> = [];
  const service = createTierlistsService(createInMemoryRepo(), fakeWorks(), undefined, (voterUserId, tierlistId, tierlistName) => {
    emitted.push([voterUserId, tierlistId, tierlistName]);
  });
  const { code, tierIds } = openPoll(service);

  service.submitBallot(code, [{ workId: "b1", tierId: tierIds[0]! }], { kind: "user", userId: "u7" });
  service.submitBallot(code, [{ workId: "b1", tierId: tierIds[1]! }], { kind: "user", userId: "u7" });

  assert.equal(emitted.length, 1);
});

test("an anonymous first ballot emits no voted_on", () => {
  const emitted: Array<[string, string, string]> = [];
  const service = createTierlistsService(createInMemoryRepo(), fakeWorks(), undefined, (voterUserId, tierlistId, tierlistName) => {
    emitted.push([voterUserId, tierlistId, tierlistName]);
  });
  const { code, tierIds } = openPoll(service);

  const outcome = service.submitBallot(code, [{ workId: "b1", tierId: tierIds[0]! }], { kind: "anonymous", ballotId: null });

  assert.equal(outcome.ok, true);
  assert.deepEqual(emitted, []);
});

test("published refs carry origin creator and timestamps", () => {
  const service = makeService();
  const ordinary = created(service.createTierlist("u1", { name: "Private list" }));
  const copy = service.openVoting("u1", ordinary.id, "anonymous")!.tierlist;

  const ref = service.getPublishedRef(copy.id);

  assert.equal(ref?.ownerUserId, "u1");
  assert.equal(ref?.createdAt, copy.createdAt);
  assert.equal(service.getPublishedRef(ordinary.id)?.id, ordinary.id);
  assert.equal(service.getPublishedRef(copy.id)?.name, "Private list");
  assert.deepEqual(service.listPublishedRefsByOwner("u1").map((r) => r.id), [copy.id]);
});

test("100 distinct member voters promote the same list and revoke creator control", () => {
  const service = makeService();
  const list = created(service.createTierlist("creator", { name: "Reference" }));
  const tiers = (list.data as { tiers: Array<{ id: string; label: string; color: string; workIds: string[] }> }).tiers;
  service.updateTierlist("creator", list.id, { data: { tiers, pool: ["b1"] } });
  const published = service.openVoting("creator", list.id, "anonymous")!.tierlist;
  const vote = [{ workId: "b1", tierId: tiers[0]!.id }];
  service.submitBallot(published.voteCode!, [], { kind: "user", userId: "abstainer" });
  for (let n = 0; n < 99; n++) {
    assert.equal(service.submitBallot(published.voteCode!, vote, { kind: "user", userId: `reader-${n}` }).ok, true);
  }
  service.submitBallot(published.voteCode!, [], { kind: "anonymous", ballotId: null });
  service.submitBallot(published.voteCode!, [], { kind: "user", userId: "creator" });
  assert.equal(service.getVotingBoard(published.voteCode!)?.eligibleVoteCount, 99);
  assert.equal(service.getVotingBoard(published.voteCode!)?.promotedAt, null);
  service.submitBallot(published.voteCode!, vote, { kind: "user", userId: "reader-99" });
  const board = service.getVotingBoard(published.voteCode!);
  assert.ok(board?.promotedAt);
  assert.equal(board?.eligibleVoteCount, 100);
  assert.equal(board?.votingOpen, false);
  assert.equal(service.getTierlist("creator", list.id), undefined);
  assert.equal(service.deleteTierlist("creator", list.id), false);
  assert.equal(service.getPublishedRef(list.id)?.id, list.id);
  assert.equal(service.getPublishedRef(list.id)?.ownerUserId, "creator");
});

test("listVotedByUser lists others' polls the account balloted on, latest ballot first", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const service = makeService();
  const first = openPoll(service);
  const second = openPoll(service);

  assert.deepEqual(service.listVotedByUser("u9"), []);

  service.submitBallot(first.code, [], { kind: "user", userId: "u9" });
  assert.deepEqual(service.listVotedByUser("u9").map((r) => r.voteCode), [first.code]);

  // A fresh ballot on a second poll reorders by latest ballot.
  t.mock.timers.tick(5);
  service.submitBallot(second.code, [], { kind: "user", userId: "u9" });
  assert.deepEqual(service.listVotedByUser("u9").map((r) => r.voteCode), [second.code, first.code]);

  // …and editing that ballot (updated_at moves) keeps it in front.
  service.submitBallot(second.code, [], { kind: "user", userId: "u9" });
  assert.deepEqual(service.listVotedByUser("u9").map((r) => r.voteCode), [second.code, first.code]);
});

test("listVotedByUser never lists the account's own polls", () => {
  const service = makeService();
  const own = openPoll(service); // openVoting seeds u1's own ballot
  assert.deepEqual(service.listVotedByUser("u1").map((r) => r.voteCode), []);

  service.submitBallot(own.code, [], { kind: "user", userId: "u2" });
  assert.deepEqual(service.listVotedByUser("u2").map((r) => r.voteCode), [own.code]);
  assert.deepEqual(service.listVotedByUser("u1").map((r) => r.voteCode), []);
});

const publishedPool = { tiers: [{ id: "s", label: "S", color: "#c9482f", workIds: [] }], pool: ["b1", "b2", "b3"] };

test("discoverWindow lists only published tier lists, matching the normalized needle, with their origin creator", () => {
  const repo = createInMemoryRepo();
  const service = createTierlistsService(repo, fakeWorks());
  created(service.createTierlist("u1", { name: "Hábitos privados" }));
  const habits = created(service.createTierlist("u1", { name: "Hábitos Atómicos", data: publishedPool, access: "anonymous" }));
  const fantasy = created(service.createTierlist("u2", { name: "Fantasy", data: publishedPool, access: "members" }));

  assert.deepEqual(service.discoverWindow("habitos", 10).map((ref) => ref.id), [habits.id]);
  assert.deepEqual(service.discoverWindow("", 10).map((ref) => ref.id).sort(), [habits.id, fantasy.id].sort());
  assert.equal(service.discoverWindow("", 1).length, 1);
  assert.deepEqual(service.discoverWindow("fantasy", 10), [{ id: fantasy.id, createdAt: fantasy.createdAt, ownerUserId: "u2", promotedAt: null }]);

  repo.promote(fantasy.id, "2026-02-01T00:00:00.000Z");
  assert.deepEqual(service.discoverWindow("fantasy", 10), [{ id: fantasy.id, createdAt: fantasy.createdAt, ownerUserId: "u2", promotedAt: "2026-02-01T00:00:00.000Z" }]);
});

test("getPublishedRefs builds the refs getPublishedRef does, for the requested ids only", () => {
  const service = makeService();
  const first = openPoll(service);
  const second = openPoll(service);
  const third = openPoll(service);
  service.submitBallot(first.code, [{ workId: "b1", tierId: first.tierIds[0]! }], { kind: "user", userId: "u7" });
  service.submitBallot(first.code, [], { kind: "anonymous", ballotId: null });
  service.submitBallot(first.code, [], { kind: "user", userId: "u8" });
  service.submitBallot(second.code, [{ workId: "b1", tierId: second.tierIds[0]! }], { kind: "user", userId: "u7" });
  service.submitBallot(third.code, [{ workId: "b1", tierId: third.tierIds[0]! }], { kind: "user", userId: "u7" });

  const refs = service.getPublishedRefs([first.copy.id, second.copy.id, "ghost"]);

  assert.deepEqual(refs.map((ref) => ref.id).sort(), [first.copy.id, second.copy.id].sort());
  const ofFirst = refs.find((ref) => ref.id === first.copy.id)!;
  assert.deepEqual(ofFirst, service.getPublishedRef(first.copy.id));
  assert.equal(ofFirst.ballotCount, 4);
  assert.equal(ofFirst.eligibleVoteCount, 1);
  assert.deepEqual(refs.find((ref) => ref.id === second.copy.id), service.getPublishedRef(second.copy.id));
  assert.deepEqual(service.getPublishedRefs([]), []);
});

test("getPublishedRefs leaves out an unpublished tier list", () => {
  const service = makeService();
  const draft = created(service.createTierlist("u1", { name: "Draft" }));
  assert.deepEqual(service.getPublishedRefs([draft.id]), []);
});

test("votedAmong returns only the requested polls the account balloted on, never its own", () => {
  const service = makeService();
  const first = openPoll(service);
  const second = openPoll(service);
  const third = openPoll(service);
  service.submitBallot(first.code, [], { kind: "user", userId: "u9" });
  service.submitBallot(third.code, [], { kind: "user", userId: "u9" });
  service.submitBallot(second.code, [], { kind: "anonymous", ballotId: null });

  assert.deepEqual(service.votedAmong("u9", [first.copy.id, second.copy.id]), [first.copy.id]);
  assert.deepEqual(service.votedAmong("u9", []), []);
  assert.deepEqual(service.votedAmong("u1", [first.copy.id, second.copy.id, third.copy.id]), []);
});

function coverFixture(peeked: Array<Array<{ isbn: string | null; title: string | null; author: string | null }>>) {
  const ranking: unknown[] = [];
  const peek = (params: Array<{ isbn: string | null; title: string | null; author: string | null }>) => {
    peeked.push(params);
    return params.map((param) => `https://covers.test/${param.title}.jpg`);
  };
  const works = fakeWorks({ books: [book("w1", { title: "Dune", author: "Frank Herbert", isbn: "123" }), book("w2", { title: "Emma", author: "Jane Austen", coverUrl: "https://stored.test/emma.jpg" })] });
  const service = createTierlistsService(createInMemoryRepo(), works, undefined, (_user, _id, _name, preview) => { ranking.push(preview); }, peek);
  const tiers = [{ id: "s", label: "S", color: "#c9482f", workIds: [] }];
  const board = created(service.createTierlist("owner", { name: "Pool", data: { tiers, pool: ["w1", "w2"] }, access: "members" }));
  return { service, board, ranking };
}

test("a null snapshot coverUrl is filled from the cover peek in refs, the voting board and the voted_on ranking", () => {
  const peeked: Array<Array<{ isbn: string | null; title: string | null; author: string | null }>> = [];
  const { service, board, ranking } = coverFixture(peeked);

  assert.deepEqual(service.getPublishedRef(board.id)?.covers, ["https://covers.test/Dune.jpg", "https://stored.test/emma.jpg"]);
  assert.deepEqual(peeked[0], [{ isbn: "123", title: "Dune", author: "Frank Herbert" }]);
  const books = service.getVotingBoard(board.voteCode!)?.publicBooks as Array<{ coverUrl: string }>;
  assert.deepEqual(books.map((book) => book.coverUrl), ["https://covers.test/Dune.jpg", "https://stored.test/emma.jpg"]);

  service.submitBallot(board.voteCode!, [{ workId: "w1", tierId: "s" }], { kind: "user", userId: "reader" });
  assert.deepEqual(ranking, [[{ label: "S", color: "#c9482f", books: [{ title: "Dune", coverUrl: "https://covers.test/Dune.jpg" }] }]]);
});

test("stored cover URLs are not peeked again", () => {
  const peeked: Array<Array<{ isbn: string | null; title: string | null; author: string | null }>> = [];
  const works = fakeWorks({ books: [book("w2", { title: "Emma", author: "Jane Austen", coverUrl: "https://stored.test/emma.jpg" })] });
  const service = createTierlistsService(createInMemoryRepo(), works, undefined, undefined, (params) => { peeked.push(params); return params.map(() => null); });
  const board = created(service.createTierlist("owner", { name: "Pool", data: { tiers: [], pool: ["w2"] }, access: "members" }));

  assert.deepEqual(service.getPublishedRef(board.id)?.covers, ["https://stored.test/emma.jpg"]);
  assert.equal(peeked.length, 0);
});

test("without a cover peek a null snapshot coverUrl stays missing", () => {
  const service = makeService();
  const board = created(service.createTierlist("owner", { name: "Pool", data: { tiers: [], pool: ["w1"] }, access: "members" }));

  assert.deepEqual(service.getPublishedRef(board.id)?.covers, []);
});

test("fillRankingCovers fills null covers by title from the snapshot and leaves unmatched ones null", () => {
  const { service, board } = coverFixture([]);
  const filled = service.fillRankingCovers(board.id, [{ label: "S", color: "#c9482f", books: [{ title: "Dune", coverUrl: null }, { title: "Emma", coverUrl: null }, { title: "Unknown", coverUrl: null }] }]);

  assert.deepEqual(filled[0]?.books, [{ title: "Dune", coverUrl: "https://covers.test/Dune.jpg" }, { title: "Emma", coverUrl: "https://stored.test/emma.jpg" }, { title: "Unknown", coverUrl: null }]);
});

test("getPublishedRefs and participationByOwner fill snapshot covers", () => {
  const peek = (params: Array<{ title: string | null }>) => params.map((param) => `https://covers.test/${param.title}.jpg`);
  const repo = createInMemoryRepo();
  const works = fakeWorks({ books: [book("w1", { title: "Dune", author: "Frank Herbert" })] });
  const service = createTierlistsService(repo, works, undefined, undefined, peek);
  const board = created(service.createTierlist("owner", { name: "Pool", data: { tiers: [], pool: ["w1"] }, access: "members" }));

  assert.deepEqual(service.getPublishedRefs([board.id])[0]?.covers, ["https://covers.test/Dune.jpg"]);
  assert.deepEqual(service.listPublishedRefsByOwner("owner")[0]?.covers, ["https://covers.test/Dune.jpg"]);

  const participating = createTierlistsService({ ...repo, listParticipation: () => [{ id: board.id, name: "Pool", public_books: JSON.stringify([{ title: "Dune", coverUrl: null }]), participants: 1, latest_at: "2026-10-01T00:00:00.000Z" }] }, works, undefined, undefined, peek);
  assert.deepEqual(participating.participationByOwner("owner", "2026-09-01T00:00:00.000Z")[0]?.covers, ["https://covers.test/Dune.jpg"]);
});

test("a throwing cover peek leaves the ballot unsaved and emits nothing", () => {
  const emitted: unknown[] = [];
  const service = createTierlistsService(createInMemoryRepo(), fakeWorks({ books: [book("w1", { title: "Dune" })] }), undefined, (...args) => { emitted.push(args); }, () => { throw new Error("books db down"); });
  const board = created(service.createTierlist("owner", { name: "Pool", data: { tiers: [{ id: "s", label: "S", color: "#c9482f", workIds: [] }], pool: ["w1"] }, access: "members" }));

  assert.throws(() => service.submitBallot(board.voteCode!, [{ workId: "w1", tierId: "s" }], { kind: "user", userId: "reader" }), /books db down/);
  assert.equal(service.getResults(board.id).ballotCount, 0);
  assert.equal(emitted.length, 0);
});
