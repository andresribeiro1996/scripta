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

test("public creation uses one immutable resource and a book snapshot", () => {
  const service = makeService();
  const data = { tiers: [{ id: "s", label: "S", color: "#c9482f", bookKeys: [] }], pool: ["b1"] };
  const created = service.createTierlist("u1", "Books", data, "anonymous", [{ key: "b1", title: "Book one" }]);
  assert.ok(created.voteCode);
  assert.equal(service.listTierlists("u1").length, 1);
  assert.equal(service.getVotingBoard(created.voteCode!)?.publicBooks?.length, 1);
  assert.equal(service.getResults(created.id).ballotCount, 0);
  assert.equal(service.updateTierlist("u1", created.id, { name: "Changed" }), undefined);
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

test("openVoting publishes the same tier list and freezes it", () => {
  const service = makeService();
  const original = service.createTierlist("u1", "Fantasy");
  const tiers = (original.data as { tiers: Array<{ id: string }> }).tiers;
  service.updateTierlist("u1", original.id, {
    data: { tiers: tiers.map((t, i) => ({ ...t, bookKeys: i === 0 ? ["b1"] : [] })), pool: ["b2"] }
  });

  const copy = service.openVoting("u1", original.id, "anonymous");

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

test("opening voting twice does not create another resource", () => {
  const service = makeService();
  const original = service.createTierlist("u1", "Fantasy");
  const first = service.openVoting("u1", original.id, "anonymous")!;
  assert.equal(service.openVoting("u1", original.id, "members"), undefined);
  assert.equal(service.getTierlist("u1", original.id)?.voteCode, first.voteCode);
});

test("a public tier list refuses data and name changes", () => {
  const service = makeService();
  const original = service.createTierlist("u1", "Fantasy");
  const copy = service.openVoting("u1", original.id, "anonymous")!;
  const frozen = copy.data;

  assert.equal(service.updateTierlist("u1", copy.id, { data: { tiers: [], pool: ["sneaky"] } }), undefined);
  assert.deepEqual(service.getTierlist("u1", copy.id)?.data, frozen);

  assert.equal(service.updateTierlist("u1", copy.id, { name: "Renamed" }), undefined);
});

test("published structure is immutable", () => {
  const service = makeService();
  const original = service.createTierlist("u1", "Fantasy");
  service.openVoting("u1", original.id, "anonymous");
  const edited = service.updateTierlist("u1", original.id, { data: { tiers: [], pool: ["b9"] } });
  assert.equal(edited, undefined);
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

function openPoll(service: ReturnType<typeof makeService>, access: "anonymous" | "members" = "anonymous") {
  const original = service.createTierlist("u1", "Fantasy");
  const tiers = (original.data as { tiers: Array<{ id: string }> }).tiers;
  service.updateTierlist("u1", original.id, {
    data: { tiers: tiers.map((t) => ({ ...t, bookKeys: [] })), pool: ["b1", "b2"] }
  });
  const copy = service.openVoting("u1", original.id, access)!;
  return { copy, code: copy.voteCode!, tierIds: tiers.map((t) => t.id) };
}

test("an anonymous ballot is created, then edited by its returned id", () => {
  const service = makeService();
  const { code, tierIds } = openPoll(service);

  const first = service.submitBallot(code, [{ bookKey: "b1", tierId: tierIds[0]! }], { kind: "anonymous", ballotId: null });
  assert.equal(first.ok, true);
  const ballotId = first.ok ? first.ballotId : "";

  const edit = service.submitBallot(code, [{ bookKey: "b1", tierId: tierIds[1]! }], { kind: "anonymous", ballotId });
  assert.equal(edit.ok, true);
  assert.equal(edit.ok && edit.ballotId, ballotId);

  const results = service.getResults(openPollIdFor(service, code));
  assert.equal(results.ballotCount, 2);
  assert.equal(results.histogram.find((c) => c.bookKey === "b1" && c.tierId === tierIds[1]!)?.votes, 1);
});

function openPollIdFor(service: ReturnType<typeof makeService>, code: string): string {
  return service.getVotingBoard(code)!.id;
}

test("a signed-in voter gets one ballot, edited in place across submissions", () => {
  const service = makeService();
  const { code, tierIds } = openPoll(service);

  const first = service.submitBallot(code, [{ bookKey: "b1", tierId: tierIds[0]! }], { kind: "user", userId: "u7" });
  const second = service.submitBallot(code, [{ bookKey: "b1", tierId: tierIds[2]! }], { kind: "user", userId: "u7" });

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
  const service = createTierlistsService(repo);
  const { code, tierIds } = openPoll(service);
  const tierlistId = service.getVotingBoard(code)!.id;

  const outcome = service.submitBallot(code, [{ bookKey: "b1", tierId: tierIds[0]! }], { kind: "user", userId: "u7" });

  const stored = repo.getBallotByVoter(tierlistId, "u7");
  assert.equal(stored?.voter_user_id, "u7");
  assert.equal(outcome.ok && outcome.ballotId, stored?.id);
});

test("members-only refuses an anonymous ballot", () => {
  const service = makeService();
  const { code, tierIds } = openPoll(service, "members");
  const outcome = service.submitBallot(code, [{ bookKey: "b1", tierId: tierIds[0]! }], { kind: "anonymous", ballotId: null });
  assert.deepEqual(outcome, { ok: false, reason: "members-only" });
});

test("a closed poll refuses new ballots", () => {
  const service = makeService();
  const { copy, code, tierIds } = openPoll(service);
  service.setVotingState("u1", copy.id, { open: false });
  const outcome = service.submitBallot(code, [{ bookKey: "b1", tierId: tierIds[0]! }], { kind: "anonymous", ballotId: null });
  assert.deepEqual(outcome, { ok: false, reason: "closed" });
});

test("an unknown code is not found", () => {
  const service = makeService();
  assert.deepEqual(service.submitBallot("nosuch", [], { kind: "anonymous", ballotId: null }), { ok: false, reason: "not-found" });
});

test("placements outside the frozen structure are rejected", () => {
  const service = makeService();
  const { code, tierIds } = openPoll(service);

  assert.deepEqual(service.submitBallot(code, [{ bookKey: "nope", tierId: tierIds[0]! }], { kind: "anonymous", ballotId: null }), {
    ok: false,
    reason: "invalid"
  });
  assert.deepEqual(service.submitBallot(code, [{ bookKey: "b1", tierId: "nosuchtier" }], { kind: "anonymous", ballotId: null }), {
    ok: false,
    reason: "invalid"
  });
  assert.deepEqual(
    service.submitBallot(
      code,
      [
        { bookKey: "b1", tierId: tierIds[0]! },
        { bookKey: "b1", tierId: tierIds[1]! }
      ],
      { kind: "anonymous", ballotId: null }
    ),
    { ok: false, reason: "invalid" }
  );
});

test("an unranked book simply has no placement", () => {
  const service = makeService();
  const { code, tierIds } = openPoll(service);
  service.submitBallot(code, [{ bookKey: "b1", tierId: tierIds[0]! }], { kind: "anonymous", ballotId: null });
  const results = service.getResults(openPollIdFor(service, code));
  assert.equal(results.histogram.some((c) => c.bookKey === "b2"), false);
});

test("getBallot rehydrates an anonymous voter's placements", () => {
  const service = makeService();
  const { code, tierIds } = openPoll(service);
  const submitted = service.submitBallot(code, [{ bookKey: "b1", tierId: tierIds[0]! }], { kind: "anonymous", ballotId: null });
  const ballotId = submitted.ok ? submitted.ballotId : "";

  const fetched = service.getBallot(code, { kind: "anonymous", ballotId });
  assert.equal(fetched.ok, true);
  assert.deepEqual(fetched.ok && fetched.placements, [{ bookKey: "b1", tierId: tierIds[0]! }]);
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
  assert.equal(Object.keys(board.tiers[0]!).includes("bookKeys"), false);
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
  service.createTierlist("u1", "Private");
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
  const service = createTierlistsService(createInMemoryRepo(), (copyId, ownerUserId) => {
    emitted.push([copyId, ownerUserId]);
  });
  const original = service.createTierlist("u1", "Fantasy");

  const copy = service.openVoting("u1", original.id, "anonymous");

  assert.ok(copy);
  assert.deepEqual(emitted, [[copy.id, "u1"]]);
});

test("published refs carry origin creator and timestamps", () => {
  const service = makeService();
  const ordinary = service.createTierlist("u1", "Private list");
  const copy = service.openVoting("u1", ordinary.id, "anonymous")!;

  const refs = service.listPublishedRefs(20, 0);

  assert.deepEqual(refs.map((r) => r.id), [copy.id]);
  assert.equal(refs[0]?.ownerUserId, "u1");
  assert.equal(refs[0]?.createdAt, copy.createdAt);
  assert.equal(service.getPublishedRef(ordinary.id)?.id, ordinary.id);
  assert.equal(service.getPublishedRef(copy.id)?.name, "Private list");
  assert.deepEqual(service.listPublishedRefsByOwner("u1").map((r) => r.id), [copy.id]);
});

test("100 distinct member voters promote the same list and revoke creator control", () => {
  const service = makeService();
  const list = service.createTierlist("creator", "Reference");
  const tiers = (list.data as { tiers: Array<{ id: string; label: string; color: string; bookKeys: string[] }> }).tiers;
  service.updateTierlist("creator", list.id, { data: { tiers, pool: ["b1"] } });
  const published = service.openVoting("creator", list.id, "anonymous")!;
  const vote = [{ bookKey: "b1", tierId: tiers[0]!.id }];
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

test("listVotedByUser lists others' polls the account balloted on, latest ballot first", async () => {
  const service = makeService();
  const first = openPoll(service);
  const second = openPoll(service);

  assert.deepEqual(service.listVotedByUser("u9"), []);

  service.submitBallot(first.code, [], { kind: "user", userId: "u9" });
  assert.deepEqual(service.listVotedByUser("u9").map((r) => r.voteCode), [first.code]);

  // A fresh ballot on a second poll reorders by latest ballot; the delay
  // keeps the two ballots' updated_at values comparable.
  await new Promise((resolve) => setTimeout(resolve, 5));
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
