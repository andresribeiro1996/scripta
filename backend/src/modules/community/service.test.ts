import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReaderProfile } from "@scripta/shared";
import type { PublishedTierlistRef } from "../tierlists/service.js";
import type { PublishedTournamentRef } from "../arena/service.js";
import type { MuralPublicPayload } from "../murals/index.js";
import type { CommunityRepository, CursorKeyset } from "./domain/ports.js";
import type { EventRow, FollowRow, ProfileRow } from "./domain/types.js";
import { MuralNotOwnedError, NotFollowingError, ProfileNotFoundError, SelfFollowError, UsernameRequiredError } from "./domain/errors.js";
import { createCommunityService, type CommunityDeps } from "./service.js";

function createRepoFake() {
  const follows = new Map<string, FollowRow>();
  const profiles = new Map<string, ProfileRow>();
  const events: EventRow[] = [];
  const key = (a: string, b: string) => `${a}:${b}`;
  const repo: CommunityRepository = {
    insertFollow(row) {
      follows.set(key(row.follower_id, row.followee_id), { ...row });
    },
    deleteFollow(followerId, followeeId) {
      return follows.delete(key(followerId, followeeId));
    },
    getFollow(followerId, followeeId) {
      return follows.get(key(followerId, followeeId));
    },
    listFollowees(followerId) {
      return [...follows.values()].filter((row) => row.follower_id === followerId).map((row) => row.followee_id);
    },
    countFollowers(userId) {
      return [...follows.values()].filter((row) => row.followee_id === userId).length;
    },
    countFollowing(userId) {
      return [...follows.values()].filter((row) => row.follower_id === userId).length;
    },
    getProfileRow(userId) {
      return profiles.get(userId);
    },
    upsertProfile(row) {
      profiles.set(row.user_id, { ...row });
    },
    insertEvent(row) {
      if (events.some((e) => e.ref_type === row.ref_type && e.ref_id === row.ref_id)) return;
      events.push({ ...row });
    },
    listEventsByUser(userId, keyset: CursorKeyset | undefined, limit) {
      return events
        .filter((e) => e.user_id === userId)
        .filter((e) => !keyset || e.created_at < keyset.createdAt || (e.created_at === keyset.createdAt && e.id < keyset.id))
        .sort((a, b) => (a.created_at === b.created_at ? (a.id > b.id ? -1 : 1) : b.created_at.localeCompare(a.created_at)))
        .slice(0, limit);
    }
  };
  return { repo, follows, profiles, events };
}

function createDeps(repo: CommunityRepository) {
  const readerProfiles = new Map<string, ReaderProfile>();
  const usernames = new Map<string, string>();
  const ownedMurals = new Set<string>();
  const muralPayloads = new Map<string, MuralPublicPayload | null>();
  const tierlistRefs = new Map<string, PublishedTierlistRef>();
  const tournamentRefs = new Map<string, PublishedTournamentRef>();
  const byNewest = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt);
  const deps: CommunityDeps = {
    repo,
    resolveProfile: (id) => readerProfiles.get(id),
    resolveProfiles: (ids) => {
      const out = new Map<string, ReaderProfile>();
      for (const id of ids) {
        const p = readerProfiles.get(id);
        if (p) out.set(id, p);
      }
      return out;
    },
    userHasUsername: (id) => usernames.has(id),
    findUserIdByUsername: (name) => [...usernames.entries()].find(([, n]) => n === name)?.[0],
    searchUsernameOwners: (q, limit) =>
      [...usernames.entries()]
        .filter(([, n]) => n.toLowerCase().includes(q.toLowerCase()))
        .map(([id]) => id)
        .slice(0, limit),
    murals: {
      ownsMural: (userId, muralId) => ownedMurals.has(`${userId}:${muralId}`),
      getMuralPublicPayload: (userId, muralId) => muralPayloads.get(`${userId}:${muralId}`) ?? null
    },
    tierlists: {
      list: (limit, offset) => [...tierlistRefs.values()].sort(byNewest).slice(offset, offset + limit),
      get: (id) => tierlistRefs.get(id),
      listByOwner: (owner) => [...tierlistRefs.values()].filter((r) => r.ownerUserId === owner).sort(byNewest)
    },
    tournaments: {
      list: (limit, offset) => [...tournamentRefs.values()].sort(byNewest).slice(offset, offset + limit),
      get: (id) => tournamentRefs.get(id),
      listByOwner: (owner) => [...tournamentRefs.values()].filter((r) => r.ownerUserId === owner).sort(byNewest)
    }
  };
  return { deps, readerProfiles, usernames, ownedMurals, muralPayloads, tierlistRefs, tournamentRefs };
}

function profileRow(userId: string, overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    user_id: userId,
    published: 1,
    mural_id: null,
    published_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides
  };
}

function reader(userId: string): ReaderProfile {
  return { username: `user-${userId}`, avatarUrl: null };
}

export function tierRef(id: string, owner: string, overrides: Partial<PublishedTierlistRef> = {}): PublishedTierlistRef {
  return {
    id,
    ownerUserId: owner,
    createdAt: "2026-09-02T00:00:00.000Z",
    voteCode: `code-${id}`,
    name: `List ${id}`,
    poolSize: 5,
    ballotCount: 2,
    votingOpen: true,
    ...overrides
  };
}

export function tournRef(id: string, owner: string, overrides: Partial<PublishedTournamentRef> = {}): PublishedTournamentRef {
  return {
    id,
    ownerUserId: owner,
    createdAt: "2026-09-03T00:00:00.000Z",
    name: `Cup ${id}`,
    bracketSize: 8,
    status: "active",
    ...overrides
  };
}

test("follow requires the target to have a published profile", () => {
  const { repo, profiles } = createRepoFake();
  const { deps } = createDeps(repo);
  const service = createCommunityService(deps);
  profiles.set("alice", profileRow("alice", { published: 0 }));
  assert.throws(() => service.follow("bob", "alice"), ProfileNotFoundError);
  profiles.set("alice", profileRow("alice"));
  service.follow("bob", "alice");
  assert.throws(() => service.follow("bob", "bob"), SelfFollowError);
  service.follow("bob", "alice");
  assert.equal(repo.countFollowers("alice"), 1);
});

test("unfollow without an existing follow throws", () => {
  const { repo } = createRepoFake();
  const { deps } = createDeps(repo);
  const service = createCommunityService(deps);
  assert.throws(() => service.unfollow("bob", "alice"), NotFollowingError);
});

test("follow state reports direction-specific counts", () => {
  const { repo, profiles } = createRepoFake();
  const { deps } = createDeps(repo);
  const service = createCommunityService(deps);
  profiles.set("alice", profileRow("alice"));
  profiles.set("dave", profileRow("dave"));
  service.follow("bob", "alice");
  service.follow("carol", "alice");
  service.follow("alice", "dave");
  assert.deepEqual(service.getFollowState("bob", "alice"), { following: true, followerCount: 2, followingCount: 1 });
  assert.deepEqual(service.getFollowState("dave", "alice"), { following: false, followerCount: 2, followingCount: 1 });
});

test("emitEvent is idempotent per (ref_type, ref_id)", () => {
  const { repo, events } = createRepoFake();
  const { deps } = createDeps(repo);
  const service = createCommunityService(deps);
  service.emitEvent("alice", "tierlist_published", "tierlist", "t1");
  service.emitEvent("alice", "tierlist_published", "tierlist", "t1");
  service.emitEvent("alice", "tournament_published", "tournament", "g1");
  assert.equal(events.length, 2);
});

const fakePayload = {} as MuralPublicPayload;

test("publish requires a username, then an owned mural", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, usernames, ownedMurals } = createDeps(repo);
  const service = createCommunityService(deps);
  profiles.set("alice", profileRow("alice", { published: 0 }));
  assert.throws(() => service.publishProfile("alice", "m1"), UsernameRequiredError);
  usernames.set("alice", "alice");
  assert.throws(() => service.publishProfile("alice", "m1"), MuralNotOwnedError);
  ownedMurals.add("alice:m1");
  service.publishProfile("alice", "m1");
  const row = repo.getProfileRow("alice")!;
  assert.equal(row.published, 1);
  assert.equal(row.mural_id, "m1");
});

test("republish swaps the mural and keeps the original published_at", () => {
  const { repo } = createRepoFake();
  const { deps, usernames, ownedMurals } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  ownedMurals.add("alice:m1");
  ownedMurals.add("alice:m2");
  service.publishProfile("alice", "m1");
  const first = repo.getProfileRow("alice")!;
  service.publishProfile("alice", "m2");
  const second = repo.getProfileRow("alice")!;
  assert.equal(second.mural_id, "m2");
  assert.equal(second.published_at, first.published_at);
});

test("unpublish clears published, keeps the row, and is a no-op when never published", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, usernames, ownedMurals } = createDeps(repo);
  const service = createCommunityService(deps);
  service.unpublishProfile("ghost");
  profiles.set("alice", profileRow("alice"));
  usernames.set("alice", "alice");
  ownedMurals.add("alice:m1");
  service.publishProfile("alice", "m1");
  service.unpublishProfile("alice");
  const row = repo.getProfileRow("alice")!;
  assert.equal(row.published, 0);
  assert.equal(row.mural_id, "m1");
});

test("getProfileByUsername assembles identity, mural, and published content", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, readerProfiles, usernames, muralPayloads, tierlistRefs, tournamentRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  readerProfiles.set("alice", reader("alice"));
  profiles.set("alice", profileRow("alice", { mural_id: "m1" }));
  muralPayloads.set("alice:m1", fakePayload);
  tierlistRefs.set("t1", tierRef("t1", "alice"));
  tournamentRefs.set("g1", tournRef("g1", "alice"));
  service.follow("bob", "alice");

  const view = service.getProfileByUsername("alice", "bob");
  assert.equal(view.profile.user.username, "user-alice");
  assert.equal(view.profile.viewerFollows, true);
  assert.equal(view.profile.followerCount, 1);
  assert.equal(view.mural, fakePayload);
  assert.deepEqual(view.published.tierlists.map((t) => t.id), ["t1"]);
  assert.deepEqual(view.published.tournaments.map((t) => t.id), ["g1"]);

  const anonymous = service.getProfileByUsername("alice");
  assert.equal(anonymous.profile.viewerFollows, undefined);
});

test("getProfileByUsername 404s for unknown and unpublished profiles", () => {
  const { repo, profiles } = createRepoFake();
  const { deps } = createDeps(repo);
  const service = createCommunityService(deps);
  assert.throws(() => service.getProfileByUsername("ghost"), ProfileNotFoundError);
  profiles.set("alice", profileRow("alice", { published: 0 }));
  assert.throws(() => service.getProfileByUsername("alice"), ProfileNotFoundError);
});

test("a profile mural deleted later resolves to null without breaking the view", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, readerProfiles, usernames } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  readerProfiles.set("alice", reader("alice"));
  profiles.set("alice", profileRow("alice", { mural_id: "deleted" }));
  const view = service.getProfileByUsername("alice");
  assert.equal(view.mural, null);
  assert.equal(view.profile.user.username, "user-alice");
});
