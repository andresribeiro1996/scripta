// backend/src/modules/tierlists/service.test.ts
//
// Exercises service.ts against a hand-written in-memory
// TierlistsRepository fake — no real SQLite database needed, same seam
// backend/README.md describes for every other module's service layer.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { TierlistsRepository } from "./domain/ports.js";
import type { TierlistRow, BallotRow, HistogramCell, Placement } from "./domain/types.js";
import { createTierlistsPublicApi, createTierlistsService } from "./service.js";

function createInMemoryRepo(): TierlistsRepository {
  const tierlists = new Map<string, TierlistRow>();
  const ballots = new Map<string, BallotRow>();
  const placements = new Map<string, Placement[]>();

  return {
    listByUser(userId) {
      return [...tierlists.values()].filter((t) => t.owner_user_id === userId);
    },
    getOwned(id, userId) {
      const t = tierlists.get(id);
      return t && t.owner_user_id === userId ? t : undefined;
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
      if (!existing || existing.owner_user_id !== userId) return false;
      tierlists.delete(id);
      return true;
    },

    getByVoteCode(code) {
      return [...tierlists.values()].find((t) => t.vote_code === code);
    },

    insertCommunityCopy(row, ballot, ps) {
      tierlists.set(row.id, { ...row });
      ballots.set(ballot.id, { ...ballot });
      placements.set(ballot.id, [...ps]);
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
          const key = JSON.stringify([p.bookKey, p.tierId]);
          const cell = counts.get(key) ?? { bookKey: p.bookKey, tierId: p.tierId, votes: 0 };
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
    }
  };
}

function makeService() {
  return createTierlistsService(createInMemoryRepo());
}

test("createTierlist stores a tier list and getTierlist round-trips it", () => {
  const service = makeService();
  const created = service.createTierlist("u1", "Favorites");
  assert.equal(created.name, "Favorites");
  const preset = (created.data as { tiers: Array<{ label: string; color: string }>; pool: string[] }).tiers;
  assert.deepEqual(
    preset.map((t) => t.label),
    ["S", "A", "B", "C", "D"]
  );
  assert.equal(preset[0]?.color, "#c9482f");
  assert.deepEqual((created.data as { pool: string[] }).pool, []);
  const fetched = service.getTierlist("u1", created.id);
  assert.deepEqual(fetched, created);
});

test("listTierlists is scoped per user", () => {
  const service = makeService();
  const a = service.createTierlist("u1", "A");
  const b = service.createTierlist("u1", "B");
  service.createTierlist("u2", "Theirs");
  const listed = service.listTierlists("u1");
  assert.equal(listed.length, 2);
  assert.ok(listed.some((t) => t.id === a.id));
  assert.ok(listed.some((t) => t.id === b.id));
});

test("updateTierlist renames without touching data", () => {
  const service = makeService();
  const t = service.createTierlist("u1", "Old");
  const updated = service.updateTierlist("u1", t.id, { name: "New" });
  assert.equal(updated?.name, "New");
  assert.equal(((updated?.data as { tiers: unknown[] })?.tiers ?? []).length, 5);
});

test("updateTierlist replaces data without touching name", () => {
  const service = makeService();
  const t = service.createTierlist("u1", "Keep");
  const next = { tiers: [{ id: "s", label: "S", color: "#ff7f7f", bookKeys: ["b1"] }], pool: ["b2"] };
  const updated = service.updateTierlist("u1", t.id, { data: next });
  assert.equal(updated?.name, "Keep");
  assert.deepEqual(updated?.data, next);
  assert.deepEqual(service.getTierlist("u1", t.id)?.data, next);
});

test("updateTierlist returns undefined for an unowned tier list", () => {
  const service = makeService();
  const theirs = service.createTierlist("u2", "Theirs");
  assert.equal(service.updateTierlist("u1", theirs.id, { name: "Mine" }), undefined);
});

test("deleteTierlist returns false for an unowned tier list", () => {
  const service = makeService();
  const theirs = service.createTierlist("u2", "Theirs");
  assert.equal(service.deleteTierlist("u1", theirs.id), false);
});

test("a deleted tier list is no longer returned by getTierlist", () => {
  const service = makeService();
  const t = service.createTierlist("u1", "Doomed");
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
  const service = createTierlistsService(repo);
  assert.deepEqual(service.getTierlist("u1", legacy.id)?.data, { tiers: [], pool: [] });
});

test("createTierlistsPublicApi resolves the raw document and defaults missing arrays", () => {
  const service = makeService();
  const api = createTierlistsPublicApi(service);

  const fresh = service.createTierlist("u1", "Fresh");
  const freshData = api.getTierlistData("u1", fresh.id);
  assert.equal(freshData?.name, "Fresh");
  assert.equal(freshData?.tiers.length, 5);
  assert.deepEqual(freshData?.pool, []);

  const doc = { tiers: [{ id: "s", label: "S", color: "#ff7f7f", bookKeys: ["b1"] }], pool: ["b2"] };
  const ranked = service.createTierlist("u1", "Ranked");
  service.updateTierlist("u1", ranked.id, { data: doc });
  assert.deepEqual(api.getTierlistData("u1", ranked.id), { name: "Ranked", tiers: doc.tiers, pool: doc.pool });

  assert.equal(api.getTierlistData("u2", ranked.id), undefined);
  assert.equal(api.getTierlistData("u1", "00000000-0000-4000-8000-000000000000"), undefined);
});

test("openVoting duplicates the tier list without touching the original", () => {
  const service = makeService();
  const original = service.createTierlist("u1", "Fantasy");
  const tiers = (original.data as { tiers: Array<{ id: string }> }).tiers;
  service.updateTierlist("u1", original.id, {
    data: { tiers: tiers.map((t, i) => ({ ...t, bookKeys: i === 0 ? ["b1"] : [] })), pool: ["b2"] }
  });

  const copy = service.openVoting("u1", original.id, "anonymous");

  assert.ok(copy);
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.name, "Fantasy (community)");
  assert.equal(copy.sourceTierlistId, original.id);
  assert.equal(copy.votingOpen, true);
  assert.equal(copy.voteAccess, "anonymous");
  assert.ok(copy.voteCode && copy.voteCode.length >= 6);

  const untouched = service.getTierlist("u1", original.id);
  assert.deepEqual((untouched?.data as { tiers: Array<{ bookKeys: string[] }> }).tiers[0]?.bookKeys, ["b1"]);
  assert.equal(untouched?.voteCode, null);
});

test("the community copy carries structure only, with the whole pool", () => {
  const service = makeService();
  const original = service.createTierlist("u1", "Fantasy");
  const tiers = (original.data as { tiers: Array<{ id: string }> }).tiers;
  service.updateTierlist("u1", original.id, {
    data: { tiers: tiers.map((t, i) => ({ ...t, bookKeys: i === 0 ? ["b1"] : [] })), pool: ["b2"] }
  });

  const copy = service.openVoting("u1", original.id, "anonymous");
  const data = copy?.data as { tiers: Array<{ id: string; bookKeys: string[] }>; pool: string[] };

  assert.deepEqual(data.tiers.map((t) => t.bookKeys), [[], [], [], [], []]);
  assert.deepEqual(data.tiers.map((t) => t.id), tiers.map((t) => t.id));
  assert.deepEqual([...data.pool].sort(), ["b1", "b2"]);
});

test("openVoting seeds the owner's ranking as the first ballot", () => {
  const service = makeService();
  const original = service.createTierlist("u1", "Fantasy");
  const tiers = (original.data as { tiers: Array<{ id: string }> }).tiers;
  const topTierId = tiers[0]!.id;
  service.updateTierlist("u1", original.id, {
    data: { tiers: tiers.map((t, i) => ({ ...t, bookKeys: i === 0 ? ["b1"] : [] })), pool: ["b2"] }
  });

  const copy = service.openVoting("u1", original.id, "anonymous")!;
  const results = service.getResults(copy.id);

  assert.equal(results.ballotCount, 1);
  assert.equal(results.histogram.find((c) => c.bookKey === "b1")?.tierId, topTierId);
  assert.equal(results.histogram.find((c) => c.bookKey === "b2"), undefined);
});

test("openVoting returns undefined for an unowned tier list", () => {
  const service = makeService();
  const theirs = service.createTierlist("u2", "Theirs");
  assert.equal(service.openVoting("u1", theirs.id, "anonymous"), undefined);
});

test("opening voting twice yields two independent community copies", () => {
  const service = makeService();
  const original = service.createTierlist("u1", "Fantasy");
  const first = service.openVoting("u1", original.id, "anonymous")!;
  const second = service.openVoting("u1", original.id, "members")!;
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.voteCode, second.voteCode);
  assert.equal(second.voteAccess, "members");
});

test("a community copy refuses data writes but still accepts a rename", () => {
  const service = makeService();
  const original = service.createTierlist("u1", "Fantasy");
  const copy = service.openVoting("u1", original.id, "anonymous")!;
  const frozen = copy.data;

  assert.equal(service.updateTierlist("u1", copy.id, { data: { tiers: [], pool: ["sneaky"] } }), undefined);
  assert.deepEqual(service.getTierlist("u1", copy.id)?.data, frozen);

  assert.equal(service.updateTierlist("u1", copy.id, { name: "Renamed" })?.name, "Renamed");
});

test("the original stays fully editable after its copy is voting", () => {
  const service = makeService();
  const original = service.createTierlist("u1", "Fantasy");
  service.openVoting("u1", original.id, "anonymous");
  const edited = service.updateTierlist("u1", original.id, { data: { tiers: [], pool: ["b9"] } });
  assert.deepEqual(edited?.data, { tiers: [], pool: ["b9"] });
});

test("setVotingState switches access and closes without losing ballots", () => {
  const service = makeService();
  const original = service.createTierlist("u1", "Fantasy");
  const copy = service.openVoting("u1", original.id, "anonymous")!;

  const tightened = service.setVotingState("u1", copy.id, { access: "members" });
  assert.equal(tightened?.voteAccess, "members");

  const closed = service.setVotingState("u1", copy.id, { open: false });
  assert.equal(closed?.votingOpen, false);
  assert.equal(closed?.voteCode, copy.voteCode);
  assert.equal(service.getResults(copy.id).ballotCount, 1);

  assert.equal(service.setVotingState("u2", copy.id, { open: true }), undefined);
});
