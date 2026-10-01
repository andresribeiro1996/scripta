import assert from "node:assert/strict";
import { test } from "node:test";
import type { IdentityKey, ReaderProfile } from "@scripta/shared";
import type { DiscoverItem, GameParticipation, SuggestedReader } from "@scripta/shared/community";
import { DEFAULT_FEED_SETTINGS, encodeCursor, normalizeFeedSettings } from "@scripta/shared/community";
import type { ParticipationItem } from "@scripta/shared/dashboard";
import type { PublishedTierlistRef } from "../tierlists/service.js";
import type { PublishedTournamentRef } from "../arena/service.js";
import type { MuralPublicPayload } from "../murals/index.js";
import type { CommunityRepository, CursorKeyset } from "./domain/ports.js";
import type { EventRow, FollowRow, ProfileRow } from "./domain/types.js";
import { InvalidCursorError, MuralNotOwnedError, NotFollowingError, ProfileNotFoundError, SelfFollowError, UsernameRequiredError } from "./domain/errors.js";
import { createCommunityService, type CommunityDeps, type CommunityService } from "./service.js";

function createRepoFake() {
  const follows = new Map<string, FollowRow>();
  const profiles = new Map<string, ProfileRow>();
  const events: EventRow[] = [];
  const key = (a: string, b: string) => `${a}:${b}`;
  const newestEvent = (a: EventRow, b: EventRow) => (a.created_at === b.created_at ? (a.id > b.id ? -1 : 1) : b.created_at.localeCompare(a.created_at));
  const newestFollow = (a: FollowRow, b: FollowRow) => (a.created_at === b.created_at ? (a.follower_id > b.follower_id ? -1 : 1) : b.created_at.localeCompare(a.created_at));
  const repo: CommunityRepository = {
    deleteUserData() {},
    insertFollow(row) {
      const k = key(row.follower_id, row.followee_id);
      if (follows.has(k)) return false;
      follows.set(k, { ...row });
      return true;
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
    listPublishedProfiles(limit) {
      return [...profiles.values()]
        .filter((row) => row.published === 1)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, limit);
    },
    getFeedSettings(userId) {
      const row = profiles.get(userId);
      if (!row || row.feed_settings === null) return null;
      try {
        return normalizeFeedSettings(JSON.parse(row.feed_settings));
      } catch {
        return null;
      }
    },
    updateFeedSettings(userId, settings) {
      const row = profiles.get(userId);
      if (!row) return;
      profiles.set(userId, { ...row, feed_settings: JSON.stringify(settings) });
    },
    insertEvent(row) {
      if (events.some((e) => e.ref_type === row.ref_type && e.ref_id === row.ref_id)) return;
      events.push({ ...row });
    },
    listEventsByUser(userId, keyset: CursorKeyset | undefined, limit, types) {
      return events
        .filter((e) => e.user_id === userId)
        .filter((e) => !types || types.includes(e.type))
        .filter((e) => !keyset || e.created_at < keyset.createdAt || (e.created_at === keyset.createdAt && e.id < keyset.id))
        .sort(newestEvent)
        .slice(0, limit);
    },
    listEventsByUserSince(userId, since, limit, types) {
      return events
        .filter((e) => e.user_id === userId && types.includes(e.type) && e.created_at > since)
        .sort(newestEvent)
        .slice(0, limit);
    },
    listFollowersByFollowee(followeeId, keyset, limit) {
      return [...follows.values()]
        .filter((row) => row.followee_id === followeeId)
        .filter((row) => !keyset || row.created_at < keyset.createdAt || (row.created_at === keyset.createdAt && row.follower_id < keyset.id))
        .sort(newestFollow)
        .slice(0, limit);
    },
    listFollowersSince(followeeId, since, limit) {
      return [...follows.values()]
        .filter((row) => row.followee_id === followeeId && row.created_at > since)
        .sort(newestFollow)
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
  const libraries = new Map<string, Record<string, unknown>>();
  const tierlistRefs = new Map<string, PublishedTierlistRef>();
  const tournamentRefs = new Map<string, PublishedTournamentRef>();
  const byNewest = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt);
  const seenAt = { value: null as string | null };
  const votes = new Set<string>();
  const tournamentVotes = new Set<string>();
  const readerGlyphs = new Map<string, IdentityKey | null>();
  const readerGlyphCalls: string[] = [];
  const tierlistParticipation: GameParticipation[] = [];
  const tournamentParticipation: GameParticipation[] = [];
  const quizParticipation: GameParticipation[] = [];
  const deps: CommunityDeps = {
    repo,
    getDashboardSeenAt: () => seenAt.value,
    setDashboardSeenAt: (_userId, value) => {
      seenAt.value = value;
    },
    resolveProfile: (id) => readerProfiles.get(id),
    resolveProfiles: (ids) => {
      const out = new Map<string, ReaderProfile>();
      for (const id of ids) {
        const p = readerProfiles.get(id);
        if (p) out.set(id, p);
      }
      return out;
    },
    resolveLibrary: (id) => libraries.get(id) ?? null,
    readerGlyphFor: (id) => {
      readerGlyphCalls.push(id);
      return readerGlyphs.get(id) ?? null;
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
      listByOwner: (owner) => [...tierlistRefs.values()].filter((r) => r.ownerUserId === owner).sort(byNewest),
      listVotedByUser: (voter) => [...tierlistRefs.values()].filter((r) => votes.has(`${voter}:${r.id}`))
    },
    tournaments: {
      list: (limit, offset) => [...tournamentRefs.values()].sort(byNewest).slice(offset, offset + limit),
      get: (id) => tournamentRefs.get(id),
      listByOwner: (owner) => [...tournamentRefs.values()].filter((r) => r.ownerUserId === owner).sort(byNewest),
      listVotedByUser: (voter) => [...tournamentRefs.values()].filter((r) => tournamentVotes.has(`${voter}:${r.id}`)).sort(byNewest)
    },
    participation: {
      tierlists: () => tierlistParticipation,
      tournaments: () => tournamentParticipation,
      quizzes: () => quizParticipation
    }
  };
  return { deps, readerProfiles, usernames, ownedMurals, muralPayloads, libraries, tierlistRefs, tournamentRefs, seenAt, votes, tournamentVotes, readerGlyphs, readerGlyphCalls, tierlistParticipation, tournamentParticipation, quizParticipation };
}

function profileRow(userId: string, overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    user_id: userId,
    published: 1,
    mural_id: null,
    published_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    feed_settings: null,
    ...overrides
  };
}

function reader(userId: string): ReaderProfile {
  return { username: `user-${userId}`, avatarUrl: null };
}

const at = (day: number) => `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`;

const ALL_KINDS: ReadonlySet<string> = new Set(["publication", "vote", "reading", "follow", "participation"]);

const pageThrough = (service: CommunityService, limit: number, kinds?: ReadonlySet<string>): string[] => {
  const ids: string[] = [];
  let cursor: string | null | undefined;
  for (let pages = 0; cursor !== null && pages < 50; pages++) {
    const page = service.getDashboard("viewer", cursor ?? undefined, limit, kinds);
    assert.ok(page.items.length <= limit);
    ids.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
  }
  return ids;
};

export function tierRef(id: string, owner: string, overrides: Partial<PublishedTierlistRef> = {}): PublishedTierlistRef {
  return {
    id,
    ownerUserId: owner,
    createdAt: "2026-09-02T00:00:00.000Z",
    voteCode: `code-${id}`,
    name: `List ${id}`,
    poolSize: 5,
    ballotCount: 2,
    eligibleVoteCount: 1,
    promotedAt: null,
    votingOpen: true,
    covers: [],
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
    covers: [],
    ...overrides
  };
}

test("follow needs an existing user, not a published profile", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles } = createDeps(repo);
  const service = createCommunityService(deps);
  assert.throws(() => service.follow("bob", "ghost"), ProfileNotFoundError);
  readerProfiles.set("alice", reader("alice"));
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
  const { repo } = createRepoFake();
  const { deps, readerProfiles } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  readerProfiles.set("dave", reader("dave"));
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
  assert.throws(() => service.publishProfile("alice", { muralId: "m1" }), UsernameRequiredError);
  usernames.set("alice", "alice");
  assert.throws(() => service.publishProfile("alice", { muralId: "m1" }), MuralNotOwnedError);
  ownedMurals.add("alice:m1");
  service.publishProfile("alice", { muralId: "m1" });
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
  service.publishProfile("alice", { muralId: "m1" });
  const first = repo.getProfileRow("alice")!;
  service.publishProfile("alice", { muralId: "m2" });
  const second = repo.getProfileRow("alice")!;
  assert.equal(second.mural_id, "m2");
  assert.equal(second.published_at, first.published_at);
});

test("publishing without a mural needs a username, then publishes with none and announces nothing", () => {
  const { repo, events } = createRepoFake();
  const { deps, usernames } = createDeps(repo);
  const service = createCommunityService(deps);
  assert.throws(() => service.publishProfile("alice", {}), UsernameRequiredError);
  assert.equal(repo.getProfileRow("alice"), undefined);
  usernames.set("alice", "alice");
  service.publishProfile("alice", {});
  const row = repo.getProfileRow("alice")!;
  assert.equal(row.published, 1);
  assert.equal(row.mural_id, null);
  assert.equal(events.filter((event) => event.type === "mural_published").length, 0);
});

test("publishing without a mural keeps the shelf mural already chosen and announces it the first time", () => {
  const { repo, events } = createRepoFake();
  const { deps, usernames, ownedMurals } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  ownedMurals.add("alice:m1");
  service.setShelfMural("alice", "m1");
  service.publishProfile("alice", {});
  const row = repo.getProfileRow("alice")!;
  assert.equal(row.published, 1);
  assert.equal(row.mural_id, "m1");
  assert.deepEqual(events.filter((event) => event.type === "mural_published").map((event) => event.ref_id), ["m1"]);
});

test("publishing without a mural drops a shelf mural that has since been deleted", () => {
  const { repo, events } = createRepoFake();
  const { deps, usernames, ownedMurals } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  ownedMurals.add("alice:m1");
  service.setShelfMural("alice", "m1");
  ownedMurals.delete("alice:m1");
  service.publishProfile("alice", {});
  const row = repo.getProfileRow("alice")!;
  assert.equal(row.published, 1);
  assert.equal(row.mural_id, null);
  assert.equal(events.filter((event) => event.type === "mural_published").length, 0);
});

test("publishing a mural the user doesn't own fails and changes nothing, even with a shelf mural already chosen", () => {
  const { repo } = createRepoFake();
  const { deps, usernames, ownedMurals } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  ownedMurals.add("alice:m1");
  service.setShelfMural("alice", "m1");
  assert.throws(() => service.publishProfile("alice", { muralId: "theirs", shareReading: true }), MuralNotOwnedError);
  const row = repo.getProfileRow("alice")!;
  assert.equal(row.published, 0);
  assert.equal(row.mural_id, "m1");
  assert.equal(service.getFeedSettings("alice").reading, false);
});

test("a first publish can choose to share reading, and can later choose not to", () => {
  const { repo } = createRepoFake();
  const { deps, usernames } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  service.publishProfile("alice", { shareReading: true });
  assert.equal(repo.getProfileRow("alice")!.published, 1);
  assert.deepEqual(service.getFeedSettings("alice"), { ...DEFAULT_FEED_SETTINGS, reading: true });
  service.publishProfile("alice", { shareReading: false });
  assert.deepEqual(service.getFeedSettings("alice"), { ...DEFAULT_FEED_SETTINGS, reading: false });
});

test("publishing changes only the reading switch, and only when asked to", () => {
  const { repo } = createRepoFake();
  const { deps, usernames } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  repo.upsertProfile(profileRow("alice", { published: 0 }));
  repo.updateFeedSettings("alice", { ...DEFAULT_FEED_SETTINGS, votes: false, follows: false });
  service.publishProfile("alice", { shareReading: true });
  assert.deepEqual(service.getFeedSettings("alice"), { ...DEFAULT_FEED_SETTINGS, votes: false, follows: false, reading: true });
  service.publishProfile("alice", {});
  assert.deepEqual(service.getFeedSettings("alice"), { ...DEFAULT_FEED_SETTINGS, votes: false, follows: false, reading: true });
});

test("unpublish clears published, keeps the row, and is a no-op when never published", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, usernames, ownedMurals } = createDeps(repo);
  const service = createCommunityService(deps);
  service.unpublishProfile("ghost");
  profiles.set("alice", profileRow("alice"));
  usernames.set("alice", "alice");
  ownedMurals.add("alice:m1");
  service.publishProfile("alice", { muralId: "m1" });
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

test("getProfileByUsername's user carries a reader glyph only when published, switched on, and settled", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, readerProfiles, usernames, readerGlyphs, readerGlyphCalls } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  readerProfiles.set("alice", reader("alice"));
  profiles.set("alice", profileRow("alice"));
  repo.updateFeedSettings("alice", { ...DEFAULT_FEED_SETTINGS, readerGlyph: true });
  readerGlyphs.set("alice", "star");

  const view = service.getProfileByUsername("alice");
  assert.equal(view.profile.user.readerGlyph, "star");
  assert.deepEqual(readerGlyphCalls, ["alice"]);
});

test("getProfileByUsername 404s for an unknown username and for the viewer's own unpublished profile", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, usernames, readerProfiles } = createDeps(repo);
  const service = createCommunityService(deps);
  assert.throws(() => service.getProfileByUsername("ghost"), ProfileNotFoundError);
  usernames.set("alice", "alice");
  readerProfiles.set("alice", reader("alice"));
  profiles.set("alice", profileRow("alice", { published: 0 }));
  assert.throws(() => service.getProfileByUsername("alice", "alice"), ProfileNotFoundError);
});

test("getProfileByUsername shows an unpublished user as private, with nothing published", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, usernames, readerProfiles, ownedMurals, muralPayloads, tierlistRefs, tournamentRefs, readerGlyphs } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  usernames.set("bob", "bob");
  readerProfiles.set("alice", reader("alice"));
  readerProfiles.set("bob", reader("bob"));
  ownedMurals.add("alice:m1");
  muralPayloads.set("alice:m1", fakePayload);
  tierlistRefs.set("t1", tierRef("t1", "alice"));
  tournamentRefs.set("g1", tournRef("g1", "alice"));
  readerGlyphs.set("alice", "star");
  profiles.set("alice", profileRow("alice", { published: 0, mural_id: "m1" }));
  service.follow("me", "alice");
  service.follow("bob", "alice");
  service.follow("alice", "bob");

  const view = service.getProfileByUsername("alice", "me");
  assert.equal(view.private, true);
  assert.equal(view.profile.user.username, "user-alice");
  assert.equal(view.profile.user.readerGlyph, undefined);
  assert.equal(view.profile.publishedAt, null);
  assert.equal(view.profile.followerCount, 2);
  assert.equal(view.profile.followingCount, 1);
  assert.equal(view.profile.viewerFollows, true);
  assert.equal(view.mural, null);
  assert.deepEqual(view.published, { tierlists: [], tournaments: [] });

  assert.equal(service.getProfileByUsername("bob").private, true);
});

test("getProfileByUsername marks a published profile as not private", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, usernames, readerProfiles } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  readerProfiles.set("alice", reader("alice"));
  profiles.set("alice", profileRow("alice"));
  const view = service.getProfileByUsername("alice");
  assert.equal(view.private, false);
  assert.equal(view.profile.publishedAt, "2026-09-01T00:00:00.000Z");
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

test("dashboard merges followees' publications and incoming follows newest first", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs, tournamentRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  readerProfiles.set("bob", reader("bob"));
  readerProfiles.set("carol", reader("carol"));
  repo.upsertProfile(profileRow("alice"));
  service.follow("viewer", "alice");
  repo.insertFollow({ follower_id: "bob", followee_id: "viewer", created_at: "2026-09-05T00:00:00.000Z" });
  service.emitEvent("alice", "tierlist_published", "tierlist", "t1");
  service.emitEvent("alice", "tournament_published", "tournament", "g1");
  tierlistRefs.set("t1", tierRef("t1", "alice"));
  tournamentRefs.set("g1", tournRef("g1", "alice"));
  repo.insertFollow({ follower_id: "carol", followee_id: "alice", created_at: "2026-09-06T00:00:00.000Z" });
  const page = service.getDashboard("viewer", undefined, 20);
  assert.equal(page.items[0]?.kind, "publication");
  assert.equal((page.items[0] as { actor: { userId: string } }).actor.userId, "alice");
  assert.ok(page.items.some((item) => item.kind === "follow" && item.id === "bob"));
  assert.ok(!page.items.some((item) => item.kind === "follow" && item.id === "carol"));
});

test("dashboard actors carry a reader glyph only when published and switched on, and the lookup runs once per author", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs, readerGlyphs, readerGlyphCalls } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("a", reader("a"));
  readerProfiles.set("b", reader("b"));
  readerProfiles.set("c", reader("c"));
  repo.upsertProfile(profileRow("a"));
  repo.updateFeedSettings("a", { ...DEFAULT_FEED_SETTINGS, readerGlyph: true });
  readerGlyphs.set("a", "star");
  repo.upsertProfile(profileRow("b"));
  repo.updateFeedSettings("b", { ...DEFAULT_FEED_SETTINGS, readerGlyph: false });
  repo.upsertProfile(profileRow("c", { published: 0 }));
  repo.updateFeedSettings("c", { ...DEFAULT_FEED_SETTINGS, readerGlyph: true });
  readerGlyphs.set("c", "star");
  repo.insertFollow({ follower_id: "viewer", followee_id: "a", created_at: "2026-09-01T00:00:00.000Z" });
  repo.insertFollow({ follower_id: "viewer", followee_id: "b", created_at: "2026-09-01T00:00:00.000Z" });
  repo.insertFollow({ follower_id: "viewer", followee_id: "c", created_at: "2026-09-01T00:00:00.000Z" });

  for (let i = 0; i < 5; i++) {
    service.emitEvent("a", "tierlist_published", "tierlist", `a${i}`);
    tierlistRefs.set(`a${i}`, tierRef(`a${i}`, "a"));
  }
  service.emitEvent("b", "tierlist_published", "tierlist", "b1");
  tierlistRefs.set("b1", tierRef("b1", "b"));
  service.emitEvent("c", "tierlist_published", "tierlist", "c1");
  tierlistRefs.set("c1", tierRef("c1", "c"));

  const page = service.getDashboard("viewer", undefined, 20);
  const actorFor = (userId: string) =>
    (page.items.find((item) => (item as { actor: { userId: string } }).actor.userId === userId) as { actor: { readerGlyph?: string } }).actor;
  assert.equal(actorFor("a").readerGlyph, "star");
  assert.equal(actorFor("b").readerGlyph, undefined);
  assert.equal(actorFor("c").readerGlyph, undefined);
  assert.equal(readerGlyphCalls.filter((id) => id === "a").length, 1);
  assert.equal(readerGlyphCalls.includes("b"), false);
  assert.deepEqual(Object.keys(actorFor("a")).sort(), ["avatarUrl", "readerGlyph", "userId", "username"]);
});

test("dashboard never looks up glyphs for authors whose rows are dropped by the page limit", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, readerGlyphs, readerGlyphCalls, tierlistRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  const ids = ["a", "b", "c", "d"];
  ids.forEach((id, i) => {
    readerProfiles.set(id, reader(id));
    repo.upsertProfile(profileRow(id));
    repo.updateFeedSettings(id, { ...DEFAULT_FEED_SETTINGS, readerGlyph: true });
    readerGlyphs.set(id, "star");
    repo.insertFollow({ follower_id: "viewer", followee_id: id, created_at: "2026-09-01T00:00:00.000Z" });
    tierlistRefs.set(`t-${id}`, tierRef(`t-${id}`, id));
    repo.insertEvent({ id: `e-${id}`, user_id: id, type: "tierlist_published", ref_type: "tierlist", ref_id: `t-${id}`, payload: null, created_at: `2026-09-0${4 - i}T00:00:00.000Z` });
  });

  const page = service.getDashboard("viewer", undefined, 2);
  assert.equal(page.items.length, 2);
  assert.deepEqual(readerGlyphCalls.sort(), ["a", "b"]);
});

test("follow rows surface only to the followee and retract on unfollow", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("bob", reader("bob"));
  repo.upsertProfile(profileRow("viewer"));
  repo.insertFollow({ follower_id: "bob", followee_id: "viewer", created_at: "2026-09-05T00:00:00.000Z" });
  assert.equal(service.getDashboard("viewer", undefined, 20).items.length, 1);
  assert.equal(service.getDashboard("bob", undefined, 20).items.length, 0);
  repo.deleteFollow("bob", "viewer");
  assert.equal(service.getDashboard("viewer", undefined, 20).items.length, 0);
});

test("personalNewCount counts unseen rows and the seen marker resets it", () => {
  const { repo } = createRepoFake();
  const { deps, seenAt, readerProfiles } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  readerProfiles.set("bob", reader("bob"));
  repo.upsertProfile(profileRow("viewer"));
  repo.insertFollow({ follower_id: "alice", followee_id: "viewer", created_at: "2026-09-05T00:00:00.000Z" });
  repo.insertFollow({ follower_id: "bob", followee_id: "viewer", created_at: "2026-09-06T00:00:00.000Z" });
  assert.equal(service.getDashboard("viewer", undefined, 20).personalNewCount, 2);
  seenAt.value = "2026-09-05T12:00:00.000Z";
  assert.equal(service.getDashboard("viewer", undefined, 20).personalNewCount, 1);
  service.markDashboardSeen("viewer");
  assert.equal(service.getDashboard("viewer", undefined, 20).personalNewCount, 0);
});

test("dashboard pagination by keyset spans both sources", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  readerProfiles.set("bob", reader("bob"));
  repo.upsertProfile(profileRow("alice"));
  repo.upsertProfile(profileRow("viewer"));
  service.follow("viewer", "alice");
  repo.insertFollow({ follower_id: "bob", followee_id: "viewer", created_at: "2026-09-04T00:00:00.000Z" });
  service.emitEvent("alice", "tierlist_published", "tierlist", "t1");
  tierlistRefs.set("t1", tierRef("t1", "alice"));
  const first = service.getDashboard("viewer", undefined, 1);
  assert.equal(first.items.length, 1);
  assert.ok(first.nextCursor);
  const second = service.getDashboard("viewer", first.nextCursor!, 1);
  assert.equal(second.items.length, 1);
  assert.notEqual(second.items[0]?.id, first.items[0]?.id);
});

test("dashboard drops publications whose content or actor vanished", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tournamentRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  repo.insertFollow({ follower_id: "viewer", followee_id: "alice", created_at: "2026-09-01T00:00:00.000Z" });
  repo.insertFollow({ follower_id: "viewer", followee_id: "ghost", created_at: "2026-09-01T00:00:00.000Z" });
  service.emitEvent("alice", "tierlist_published", "tierlist", "gone");
  service.emitEvent("ghost", "tournament_published", "tournament", "g1");
  tournamentRefs.set("g1", tournRef("g1", "ghost"));
  assert.equal(service.getDashboard("viewer", undefined, 20).items.length, 0);
});

test("an unparseable dashboard cursor is a 400-worthy error", () => {
  const { repo } = createRepoFake();
  const { deps } = createDeps(repo);
  const service = createCommunityService(deps);
  assert.throws(() => service.getDashboard("viewer", "###", 20), InvalidCursorError);
});

test("your games' participation shows as one row per game", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistParticipation } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("ana", reader("ana"));
  repo.upsertProfile(profileRow("ana"));
  tierlistParticipation.push({ id: "t1", name: "Sci-fi", covers: ["a", "b", "c", "d"], participantCount: 4, latestAt: at(2), recent: [{ userId: "ana", at: at(2) }, { userId: "ghost", at: at(1) }] });
  const { items } = service.getDashboard("viewer", undefined, 20, ALL_KINDS);
  assert.equal(items.length, 1);
  const row = items[0] as ParticipationItem;
  assert.equal(row.kind, "participation");
  assert.equal(row.id, "tierlist:t1");
  assert.equal(row.game.covers.length, 3);
  assert.equal(row.count, 4);
  assert.equal(row.createdAt, at(2));
  assert.deepEqual(row.actors.map((actor) => actor.username), ["user-ana"]);
});

test("each kind of game keeps its own kind and id", () => {
  const { repo } = createRepoFake();
  const { deps, tierlistParticipation, tournamentParticipation, quizParticipation } = createDeps(repo);
  const service = createCommunityService(deps);
  const game = (id: string, day: number) => ({ id, name: `Game ${id}`, covers: [], participantCount: 1, latestAt: at(day), recent: [] });
  tierlistParticipation.push(game("a", 1));
  tournamentParticipation.push(game("a", 2));
  quizParticipation.push(game("a", 3));
  const rows = service.getDashboard("viewer", undefined, 20, ALL_KINDS).items as ParticipationItem[];
  assert.deepEqual(rows.map((row) => [row.id, row.game.kind, row.game.id]), [["quiz:a", "quiz", "a"], ["tournament:a", "tournament", "a"], ["tierlist:a", "tierlist", "a"]]);
});

test("participants who are private or hide their votes are counted, never named", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistParticipation } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("bo", reader("bo"));
  readerProfiles.set("cy", reader("cy"));
  repo.upsertProfile(profileRow("bo", { published: 0 }));
  repo.upsertProfile(profileRow("cy"));
  repo.updateFeedSettings("cy", { ...DEFAULT_FEED_SETTINGS, votes: false });
  tierlistParticipation.push({ id: "t1", name: "Sci-fi", covers: [], participantCount: 2, latestAt: at(2), recent: [{ userId: "bo", at: at(2) }, { userId: "cy", at: at(1) }] });
  const row = service.getDashboard("viewer", undefined, 20, ALL_KINDS).items[0] as ParticipationItem;
  assert.deepEqual(row.actors, []);
  assert.equal(row.count, 2);
});

test("no more than three participants are named", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistParticipation } = createDeps(repo);
  const service = createCommunityService(deps);
  const ids = ["p1", "p2", "p3", "p4"];
  for (const id of ids) {
    readerProfiles.set(id, reader(id));
    repo.upsertProfile(profileRow(id));
  }
  tierlistParticipation.push({ id: "t1", name: "Sci-fi", covers: [], participantCount: 4, latestAt: at(4), recent: ids.map((userId, i) => ({ userId, at: at(4 - i) })) });
  const row = service.getDashboard("viewer", undefined, 20, ALL_KINDS).items[0] as ParticipationItem;
  assert.deepEqual(row.actors.map((actor) => actor.username), ["user-p1", "user-p2", "user-p3"]);
  assert.equal(row.count, 4);
});

test("hidden events can't push a visible one off the first page", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  repo.upsertProfile(profileRow("alice"));
  repo.insertFollow({ follower_id: "viewer", followee_id: "alice", created_at: at(1) });
  tierlistRefs.set("t1", tierRef("t1", "alice"));
  repo.insertEvent({ id: "e-pub", user_id: "alice", type: "tierlist_published", ref_type: "tierlist", ref_id: "t1", payload: null, created_at: at(2) });
  for (let i = 0; i < 30; i++) {
    repo.insertEvent({ id: `e-book-${i}`, user_id: "alice", type: "book_added", ref_type: "book", ref_id: `b${i}`, payload: JSON.stringify({ title: "T", author: "A" }), created_at: `2026-09-03T00:00:${String(i).padStart(2, "0")}.000Z` });
  }
  assert.deepEqual(service.getDashboard("viewer", undefined, 20).items.map((item) => item.id), ["e-pub"]);
});

test("counts come from the rows the list shows", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs, tierlistParticipation, seenAt } = createDeps(repo);
  const service = createCommunityService(deps);
  seenAt.value = at(10);
  for (const id of ["alice", "bob", "old-fan"]) readerProfiles.set(id, reader(id));
  repo.upsertProfile(profileRow("alice"));
  repo.insertFollow({ follower_id: "viewer", followee_id: "alice", created_at: at(1) });
  tierlistRefs.set("t-old", tierRef("t-old", "alice"));
  tierlistRefs.set("t-new", tierRef("t-new", "alice"));
  repo.insertEvent({ id: "e-old", user_id: "alice", type: "tierlist_published", ref_type: "tierlist", ref_id: "t-old", payload: null, created_at: at(9) });
  repo.insertEvent({ id: "e-new", user_id: "alice", type: "tierlist_published", ref_type: "tierlist", ref_id: "t-new", payload: null, created_at: at(11) });
  for (let i = 0; i < 5; i++) {
    repo.insertEvent({ id: `e-book-${i}`, user_id: "alice", type: "book_added", ref_type: "book", ref_id: `b${i}`, payload: JSON.stringify({ title: "T", author: "A" }), created_at: at(12) });
  }
  repo.insertEvent({ id: "e-following", user_id: "alice", type: "following", ref_type: "user", ref_id: "bob", payload: JSON.stringify({ username: "user-bob" }), created_at: at(12) });
  repo.insertEvent({ id: "e-mural", user_id: "alice", type: "mural_published", ref_type: "mural", ref_id: "m1", payload: null, created_at: at(12) });
  repo.insertFollow({ follower_id: "old-fan", followee_id: "viewer", created_at: at(9) });
  repo.insertFollow({ follower_id: "bob", followee_id: "viewer", created_at: at(11) });
  tierlistParticipation.push({ id: "g-old", name: "Old", covers: [], participantCount: 1, latestAt: at(9), recent: [] });
  tierlistParticipation.push({ id: "g-seen", name: "Seen", covers: [], participantCount: 1, latestAt: at(10), recent: [] });
  tierlistParticipation.push({ id: "g-new", name: "New", covers: [], participantCount: 1, latestAt: at(12), recent: [] });
  const page = service.getDashboard("viewer", undefined, 20, ALL_KINDS);
  assert.equal(page.followingNewCount, 1);
  assert.equal(page.personalNewCount, 2);
  assert.equal(page.seenAt, at(10));
});

test("each count stops at 100", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  repo.upsertProfile(profileRow("alice"));
  repo.insertFollow({ follower_id: "viewer", followee_id: "alice", created_at: at(1) });
  for (let i = 0; i < 105; i++) {
    readerProfiles.set(`fan${i}`, reader(`fan${i}`));
    repo.insertFollow({ follower_id: `fan${i}`, followee_id: "viewer", created_at: at(2) });
    tierlistRefs.set(`t${i}`, tierRef(`t${i}`, "alice"));
    repo.insertEvent({ id: `e${i}`, user_id: "alice", type: "tierlist_published", ref_type: "tierlist", ref_id: `t${i}`, payload: null, created_at: at(3) });
  }
  const page = service.getDashboard("viewer", undefined, 20);
  assert.equal(page.personalNewCount, 100);
  assert.equal(page.followingNewCount, 100);
});

test("with no seen marker every row counts", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistParticipation } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("bob", reader("bob"));
  repo.insertFollow({ follower_id: "bob", followee_id: "viewer", created_at: at(2) });
  tierlistParticipation.push({ id: "t1", name: "Sci-fi", covers: [], participantCount: 1, latestAt: at(3), recent: [] });
  const page = service.getDashboard("viewer", undefined, 20, ALL_KINDS);
  assert.equal(page.seenAt, null);
  assert.equal(page.personalNewCount, 2);
  assert.equal(page.followingNewCount, 0);
});

test("participation rows page with the cursor, without repeats or gaps", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistParticipation } = createDeps(repo);
  const service = createCommunityService(deps);
  for (const [id, day] of [["g1", 1], ["g2", 3], ["g3", 5]] as const) tierlistParticipation.push({ id, name: id, covers: [], participantCount: 1, latestAt: at(day), recent: [] });
  for (const [id, day] of [["f1", 2], ["f2", 4], ["f3", 6]] as const) {
    readerProfiles.set(id, reader(id));
    repo.insertFollow({ follower_id: id, followee_id: "viewer", created_at: at(day) });
  }
  assert.deepEqual(pageThrough(service, 2, ALL_KINDS), ["f3", "tierlist:g3", "f2", "tierlist:g2", "f1", "tierlist:g1"]);
});

test("a cursor page carries no counts", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, seenAt } = createDeps(repo);
  const service = createCommunityService(deps);
  seenAt.value = at(1);
  for (const [id, day] of [["f1", 2], ["f2", 3], ["f3", 4]] as const) {
    readerProfiles.set(id, reader(id));
    repo.insertFollow({ follower_id: id, followee_id: "viewer", created_at: at(day) });
  }
  const first = service.getDashboard("viewer", undefined, 2);
  assert.equal(first.seenAt, at(1));
  assert.equal(first.personalNewCount, 3);
  const next = service.getDashboard("viewer", first.nextCursor!, 2);
  assert.deepEqual(next.items.map((item) => item.id), ["f1"]);
  assert.equal(next.seenAt, null);
  assert.equal(next.personalNewCount, 0);
  assert.equal(next.followingNewCount, 0);
});

test("one unrenderable row in a fetch window can't end the feed early", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  repo.upsertProfile(profileRow("alice"));
  repo.insertFollow({ follower_id: "viewer", followee_id: "alice", created_at: at(1) });
  for (let i = 0; i < 22; i++) {
    const n = String(i).padStart(2, "0");
    repo.insertEvent({ id: `v${n}`, user_id: "alice", type: "voted_on", ref_type: "tierlist", ref_id: `t${n}`, payload: null, created_at: `2026-09-02T00:00:${n}.000Z` });
    if (i !== 21) tierlistRefs.set(`t${n}`, tierRef(`t${n}`, "carol"));
  }
  assert.deepEqual(pageThrough(service, 20), Array.from({ length: 21 }, (_, i) => `v${String(20 - i).padStart(2, "0")}`));
});

test("a window of unrenderable rows can't make the page skip a visible row behind it", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs, tierlistParticipation } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  repo.upsertProfile(profileRow("alice"));
  repo.insertFollow({ follower_id: "viewer", followee_id: "alice", created_at: at(1) });
  for (const [id, day] of [["a1", 20], ["a2", 19], ["a3", 18], ["a4", 17]] as const) {
    repo.insertEvent({ id, user_id: "alice", type: "voted_on", ref_type: "tierlist", ref_id: `t-${id}`, payload: null, created_at: at(day) });
  }
  tierlistRefs.set("t-a4", tierRef("t-a4", "carol"));
  for (const [id, day] of [["g1", 16], ["g2", 15], ["g3", 14]] as const) tierlistParticipation.push({ id, name: id, covers: [], participantCount: 1, latestAt: at(day), recent: [] });
  assert.deepEqual(pageThrough(service, 2, ALL_KINDS), ["a4", "tierlist:g1", "tierlist:g2", "tierlist:g3"]);
});

test("rows from a quieter source don't jump ahead of the unfetched rows of a busier one", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  for (const id of ["alice", "bob"]) {
    readerProfiles.set(id, reader(id));
    repo.upsertProfile(profileRow(id));
    repo.insertFollow({ follower_id: "viewer", followee_id: id, created_at: at(1) });
  }
  for (const [id, user, day] of [["b1", "bob", 20], ["b2", "bob", 19], ["b3", "bob", 18], ["b4", "bob", 17], ["a1", "alice", 16], ["a2", "alice", 15], ["a3", "alice", 14]] as const) {
    repo.insertEvent({ id, user_id: user, type: "voted_on", ref_type: "tierlist", ref_id: `t-${id}`, payload: null, created_at: at(day) });
    if (id !== "b1" && id !== "b2" && id !== "b3") tierlistRefs.set(`t-${id}`, tierRef(`t-${id}`, "carol"));
  }
  assert.deepEqual(pageThrough(service, 2), ["b4", "a1", "a2", "a3"]);
});

test("a run of unrenderable rows longer than a page's refills doesn't strand what comes after it", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  repo.upsertProfile(profileRow("alice"));
  repo.insertFollow({ follower_id: "viewer", followee_id: "alice", created_at: at(1) });
  const second = (n: number) => `2026-09-10T00:00:${String(n).padStart(2, "0")}.000Z`;
  repo.insertEvent({ id: "x1", user_id: "alice", type: "voted_on", ref_type: "tierlist", ref_id: "t-x1", payload: null, created_at: second(40) });
  for (let i = 1; i <= 20; i++) repo.insertEvent({ id: `d${String(i).padStart(2, "0")}`, user_id: "alice", type: "voted_on", ref_type: "tierlist", ref_id: `t-d${i}`, payload: null, created_at: second(40 - i) });
  repo.insertEvent({ id: "x2", user_id: "alice", type: "voted_on", ref_type: "tierlist", ref_id: "t-x2", payload: null, created_at: second(5) });
  tierlistRefs.set("t-x1", tierRef("t-x1", "carol"));
  tierlistRefs.set("t-x2", tierRef("t-x2", "carol"));
  assert.deepEqual(pageThrough(service, 2), ["x1", "x2"]);
});

test("a page gives up refilling after five fetches and hands back a cursor", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  repo.upsertProfile(profileRow("alice"));
  repo.insertFollow({ follower_id: "viewer", followee_id: "alice", created_at: at(1) });
  for (let i = 0; i < 40; i++) {
    const n = String(i).padStart(2, "0");
    repo.insertEvent({ id: `d${n}`, user_id: "alice", type: "voted_on", ref_type: "tierlist", ref_id: `t-d${n}`, payload: null, created_at: `2026-09-10T00:00:${n}.000Z` });
  }
  const listEventsByUser = repo.listEventsByUser;
  let fetches = 0;
  repo.listEventsByUser = (...args) => {
    fetches++;
    return listEventsByUser(...args);
  };
  const page = service.getDashboard("viewer", encodeCursor({ createdAt: at(11), id: "z" }), 2);
  assert.deepEqual(page.items, []);
  assert.ok(page.nextCursor);
  assert.equal(fetches, 5);
});

test("a page that finds too few rows in its first fetch tops up from the next", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  repo.upsertProfile(profileRow("alice"));
  repo.insertFollow({ follower_id: "viewer", followee_id: "alice", created_at: at(1) });
  for (const [id, day] of [["x1", 20], ["d1", 19], ["d2", 18], ["x2", 17], ["x3", 16], ["x4", 15]] as const) {
    repo.insertEvent({ id, user_id: "alice", type: "voted_on", ref_type: "tierlist", ref_id: `t-${id}`, payload: null, created_at: at(day) });
    if (id.startsWith("x")) tierlistRefs.set(`t-${id}`, tierRef(`t-${id}`, "carol"));
  }
  const first = service.getDashboard("viewer", undefined, 2);
  assert.deepEqual(first.items.map((item) => item.id), ["x1", "x2"]);
  const second = service.getDashboard("viewer", first.nextCursor!, 2);
  assert.deepEqual(second.items.map((item) => item.id), ["x3", "x4"]);
  assert.equal(second.nextCursor, null);
});

test("an event, a follow and a participation row sharing a time each appear once, largest id first", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs, tierlistParticipation } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  readerProfiles.set("fan", reader("fan"));
  repo.upsertProfile(profileRow("alice"));
  repo.insertFollow({ follower_id: "viewer", followee_id: "alice", created_at: at(1) });
  tierlistRefs.set("t1", tierRef("t1", "alice"));
  repo.insertEvent({ id: "e-tie", user_id: "alice", type: "tierlist_published", ref_type: "tierlist", ref_id: "t1", payload: null, created_at: at(5) });
  repo.insertFollow({ follower_id: "fan", followee_id: "viewer", created_at: at(5) });
  tierlistParticipation.push({ id: "g-tie", name: "Tie", covers: [], participantCount: 1, latestAt: at(5), recent: [] });
  assert.deepEqual(pageThrough(service, 1, ALL_KINDS), ["tierlist:g-tie", "fan", "e-tie"]);
});

test("rows tied with the fetch horizon's time are split by id, so none is skipped", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  for (const id of ["alice", "c"]) readerProfiles.set(id, reader(id));
  repo.upsertProfile(profileRow("alice"));
  repo.insertFollow({ follower_id: "viewer", followee_id: "alice", created_at: at(1) });
  for (const [id, day] of [["a1", 12], ["a2", 11], ["m", 10], ["e", 10]] as const) {
    repo.insertEvent({ id, user_id: "alice", type: "voted_on", ref_type: "tierlist", ref_id: `t-${id}`, payload: null, created_at: at(day) });
    if (day === 10) tierlistRefs.set(`t-${id}`, tierRef(`t-${id}`, "carol"));
  }
  repo.insertFollow({ follower_id: "c", followee_id: "viewer", created_at: at(10) });
  assert.deepEqual(pageThrough(service, 2), ["m", "e", "c"]);
});

test("only the participants that get named have a glyph looked up", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, readerGlyphs, readerGlyphCalls, tierlistParticipation } = createDeps(repo);
  const service = createCommunityService(deps);
  const ids = ["p1", "p2", "p3", "p4", "p5"];
  for (const id of ids) {
    if (id !== "p1") readerProfiles.set(id, reader(id));
    repo.upsertProfile(profileRow(id));
    repo.updateFeedSettings(id, { ...DEFAULT_FEED_SETTINGS, readerGlyph: true });
    readerGlyphs.set(id, "star");
  }
  tierlistParticipation.push({ id: "t1", name: "Sci-fi", covers: [], participantCount: 5, latestAt: at(5), recent: ids.map((userId, i) => ({ userId, at: at(5 - i) })) });
  const row = service.getDashboard("viewer", undefined, 20, ALL_KINDS).items[0] as ParticipationItem;
  assert.deepEqual(row.actors.map((actor) => actor.username), ["user-p2", "user-p3", "user-p4"]);
  assert.deepEqual(readerGlyphCalls, ["p2", "p3", "p4"]);
});

function serviceWithEveryKindOfRow(): CommunityService {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs, tierlistParticipation, tournamentParticipation, quizParticipation } = createDeps(repo);
  const service = createCommunityService(deps);
  for (const id of ["alice", "bob"]) readerProfiles.set(id, reader(id));
  repo.upsertProfile(profileRow("alice"));
  repo.updateFeedSettings("alice", { ...DEFAULT_FEED_SETTINGS, reading: true });
  repo.insertFollow({ follower_id: "viewer", followee_id: "alice", created_at: at(1) });
  tierlistRefs.set("t-mine", tierRef("t-mine", "alice"));
  tierlistRefs.set("t-other", tierRef("t-other", "carol"));
  repo.insertEvent({ id: "e-pub", user_id: "alice", type: "tierlist_published", ref_type: "tierlist", ref_id: "t-mine", payload: null, created_at: at(3) });
  repo.insertEvent({ id: "e-vote", user_id: "alice", type: "voted_on", ref_type: "tierlist", ref_id: "t-other", payload: null, created_at: at(4) });
  repo.insertEvent({ id: "e-read", user_id: "alice", type: "book_added", ref_type: "book", ref_id: "b1", payload: JSON.stringify({ title: "Dune", author: "Herbert" }), created_at: at(5) });
  repo.insertFollow({ follower_id: "bob", followee_id: "viewer", created_at: at(6) });
  const game = (id: string, day: number) => ({ id, name: `Game ${id}`, covers: [], participantCount: 1, latestAt: at(day), recent: [] });
  tierlistParticipation.push(game("g-tier", 7));
  tournamentParticipation.push(game("g-cup", 8));
  quizParticipation.push(game("g-quiz", 9));
  return service;
}

test("a dashboard without kinds gets only the four kinds builds before step 2 can draw", () => {
  const page = serviceWithEveryKindOfRow().getDashboard("viewer", undefined, 20);
  assert.deepEqual(page.items.map((item) => item.kind), ["follow", "reading", "vote", "publication"]);
  assert.equal(page.personalNewCount, 1);
  assert.equal(page.followingNewCount, 3);
});

test("the kinds a client lists come back, and are counted", () => {
  const page = serviceWithEveryKindOfRow().getDashboard("viewer", undefined, 20, ALL_KINDS);
  assert.deepEqual(page.items.map((item) => item.id), ["quiz:g-quiz", "tournament:g-cup", "tierlist:g-tier", "bob", "e-read", "e-vote", "e-pub"]);
  assert.equal(page.personalNewCount, 4);
  assert.equal(page.followingNewCount, 3);
});

test("rows of a kind the client didn't list are never fetched, so every page but the last stays full", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  repo.upsertProfile(profileRow("alice"));
  repo.updateFeedSettings("alice", { ...DEFAULT_FEED_SETTINGS, reading: true });
  repo.insertFollow({ follower_id: "viewer", followee_id: "alice", created_at: at(1) });
  for (let i = 0; i < 5; i++) {
    tierlistRefs.set(`t${i}`, tierRef(`t${i}`, "alice"));
    repo.insertEvent({ id: `e${i}`, user_id: "alice", type: "tierlist_published", ref_type: "tierlist", ref_id: `t${i}`, payload: null, created_at: at(10 + i) });
  }
  for (let i = 0; i < 16; i++) {
    readerProfiles.set(`fan${i}`, reader(`fan${i}`));
    repo.insertFollow({ follower_id: `fan${i}`, followee_id: "viewer", created_at: at(20) });
    repo.insertEvent({ id: `r${i}`, user_id: "alice", type: "book_added", ref_type: "book", ref_id: `b${i}`, payload: JSON.stringify({ title: "T", author: "A" }), created_at: at(15) });
  }
  const kinds = new Set(["publication", "vote", "participation"]);
  const pages: string[][] = [];
  let cursor: string | undefined;
  do {
    const page = service.getDashboard("viewer", cursor, 2, kinds);
    pages.push(page.items.map((item) => item.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined && pages.length < 10);
  assert.deepEqual(pages, [["e4", "e3"], ["e2", "e1"], ["e0"]]);
  const counted = service.getDashboard("viewer", undefined, 2, kinds);
  assert.equal(counted.personalNewCount, 0);
  assert.equal(counted.followingNewCount, 5);
});

test("kind names this server doesn't know are ignored", () => {
  const page = serviceWithEveryKindOfRow().getDashboard("viewer", undefined, 20, new Set(["publication", "reply"]));
  assert.deepEqual(page.items.map((item) => item.kind), ["publication"]);
  assert.equal(page.personalNewCount, 0);
  assert.equal(page.followingNewCount, 1);
});

test("discover merges both content kinds newest first", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs, tournamentRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  readerProfiles.set("bob", reader("bob"));
  tierlistRefs.set("t1", tierRef("t1", "alice", { createdAt: "2026-09-02T00:00:00.000Z" }));
  tournamentRefs.set("g1", tournRef("g1", "bob", { createdAt: "2026-09-01T00:00:00.000Z" }));

  const page = service.getDiscover("all", "", 10, 0);
  assert.deepEqual(
    page.items.map((item) => [item.content.kind, item.author.username]),
    [["tierlist", "user-alice"], ["tournament", "user-bob"]]
  );
  assert.equal(page.nextOffset, null);
});

test("discover filters by type and by name substring, and paginates by offset", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs, tournamentRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  tierlistRefs.set("t1", tierRef("t1", "alice", { name: "Fantasy ranked" }));
  tierlistRefs.set("t2", tierRef("t2", "alice", { createdAt: "2026-09-04T00:00:00.000Z" }));
  tournamentRefs.set("g1", tournRef("g1", "alice"));

  assert.deepEqual(service.getDiscover("tournament", "", 10, 0).items.map((i) => i.content.kind), ["tournament"]);
  const searched = service.getDiscover("all", "fantasy", 10, 0);
  assert.deepEqual(searched.items.map((i) => i.content.name), ["Fantasy ranked"]);

  const page1 = service.getDiscover("all", "", 1, 0);
  assert.equal(page1.items.length, 1);
  assert.equal(page1.nextOffset, 1);
  const page2 = service.getDiscover("all", "", 1, 1);
  assert.equal(page2.items.length, 1);
  assert.equal(page2.nextOffset, 2);
  const page3 = service.getDiscover("all", "", 1, 2);
  assert.equal(page3.items.length, 1);
  assert.equal(page3.nextOffset, null);
});

test("a single-type discover filter reports its next page", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  tierlistRefs.set("t1", tierRef("t1", "alice", { createdAt: "2026-09-01T00:00:00.000Z" }));
  tierlistRefs.set("t2", tierRef("t2", "alice", { createdAt: "2026-09-02T00:00:00.000Z" }));
  tierlistRefs.set("t3", tierRef("t3", "alice", { createdAt: "2026-09-03T00:00:00.000Z" }));

  const page1 = service.getDiscover("tierlist", "", 2, 0);
  assert.deepEqual(page1.items.map((i) => i.content.id), ["t3", "t2"]);
  assert.equal(page1.nextOffset, 2);
  const page2 = service.getDiscover("tierlist", "", 2, 2);
  assert.deepEqual(page2.items.map((i) => i.content.id), ["t1"]);
  assert.equal(page2.nextOffset, null);
});

test("discover search finds a match older than the first page", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  tierlistRefs.set("old", tierRef("old", "alice", { name: "Fantasy classics", createdAt: "2026-09-01T00:00:00.000Z" }));
  for (let day = 2; day <= 9; day++) {
    tierlistRefs.set(`t${day}`, tierRef(`t${day}`, "alice", { name: `List ${day}`, createdAt: `2026-09-0${day}T00:00:00.000Z` }));
  }

  const page = service.getDiscover("all", "fantasy", 2, 0);
  assert.deepEqual(page.items.map((i) => i.content.id), ["old"]);
  assert.equal(page.nextOffset, null);
});

test("discover drops rows whose author has no reader profile", () => {
  const { repo } = createRepoFake();
  const { deps, tierlistRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  tierlistRefs.set("t1", tierRef("t1", "alice"));
  assert.deepEqual(service.getDiscover("all", "", 10, 0), { items: [], nextOffset: null });
});

test("promoted references remain discoverable after the creator disappears", () => {
  const { repo } = createRepoFake();
  const { deps, tierlistRefs } = createDeps(repo);
  tierlistRefs.set("t1", tierRef("t1", "alice", { promotedAt: "2026-09-03T00:00:00.000Z", votingOpen: false }));
  const items = createCommunityService(deps).getDiscover("tierlist", "", 10, 0).items;
  assert.equal(items.length, 1);
  assert.equal(items[0]?.author.unavailable, true);
  assert.equal(items[0]?.content.kind, "tierlist");
});

test("discover marks the content the viewer has voted in, and only for a signed-in viewer", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs, tournamentRefs, votes, tournamentVotes } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  tierlistRefs.set("t1", tierRef("t1", "alice", { createdAt: "2026-09-03T00:00:00.000Z" }));
  tierlistRefs.set("t2", tierRef("t2", "alice", { createdAt: "2026-09-02T00:00:00.000Z" }));
  tournamentRefs.set("g1", tournRef("g1", "alice", { createdAt: "2026-09-01T00:00:00.000Z" }));
  tournamentRefs.set("g2", tournRef("g2", "alice", { createdAt: "2026-08-31T00:00:00.000Z" }));
  votes.add("viewer:t1");
  tournamentVotes.add("viewer:g1");

  const voted = (items: DiscoverItem[]) => items.map((item) => item.content.viewerVoted ?? false);
  assert.deepEqual(voted(service.getDiscover("all", "", 10, 0, "viewer").items), [true, false, true, false]);
  assert.deepEqual(voted(service.getDiscover("all", "", 10, 0).items), [false, false, false, false]);
});

test("discover authors carry a reader glyph only when published and switched on", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs, readerGlyphs, readerGlyphCalls } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  readerProfiles.set("bob", reader("bob"));
  repo.upsertProfile(profileRow("alice"));
  repo.updateFeedSettings("alice", { ...DEFAULT_FEED_SETTINGS, readerGlyph: true });
  readerGlyphs.set("alice", "star");
  repo.upsertProfile(profileRow("bob"));
  repo.updateFeedSettings("bob", { ...DEFAULT_FEED_SETTINGS, readerGlyph: false });
  tierlistRefs.set("t1", tierRef("t1", "alice", { createdAt: "2026-09-02T00:00:00.000Z" }));
  tierlistRefs.set("t2", tierRef("t2", "bob", { createdAt: "2026-09-01T00:00:00.000Z" }));

  const items = service.getDiscover("all", "", 10, 0).items;
  assert.equal(items.find((i) => i.content.id === "t1")?.author.readerGlyph, "star");
  assert.equal(items.find((i) => i.content.id === "t2")?.author.readerGlyph, undefined);
  assert.equal(readerGlyphCalls.includes("bob"), false);
});

test("discover carries no glyph for an unpublished author with the switch on", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs, readerGlyphs, readerGlyphCalls } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("carol", reader("carol"));
  repo.upsertProfile(profileRow("carol", { published: 0 }));
  repo.updateFeedSettings("carol", { ...DEFAULT_FEED_SETTINGS, readerGlyph: true });
  readerGlyphs.set("carol", "star");
  tierlistRefs.set("t1", tierRef("t1", "carol"));

  const items = service.getDiscover("all", "", 10, 0).items;
  assert.equal(items.find((i) => i.content.id === "t1")?.author.readerGlyph, undefined);
  assert.equal(readerGlyphCalls.includes("carol"), false);
});

test("discover only looks up glyphs for authors on the returned page, not the whole scan window", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs, readerGlyphs, readerGlyphCalls } = createDeps(repo);
  const service = createCommunityService(deps);
  const ids = ["a", "b", "c", "d", "e"];
  ids.forEach((id, i) => {
    readerProfiles.set(id, reader(id));
    repo.upsertProfile(profileRow(id));
    repo.updateFeedSettings(id, { ...DEFAULT_FEED_SETTINGS, readerGlyph: true });
    readerGlyphs.set(id, "star");
    tierlistRefs.set(`t-${id}`, tierRef(`t-${id}`, id, { createdAt: `2026-09-0${i + 1}T00:00:00.000Z` }));
  });

  const page = service.getDiscover("all", "", 2, 0);
  assert.equal(page.items.length, 2);
  assert.deepEqual(readerGlyphCalls.sort(), ["d", "e"]);
});

test("people search finds unpublished users as private and excludes self", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, readerProfiles, usernames } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  usernames.set("alina", "alina");
  usernames.set("alix", "alix");
  usernames.set("bob", "bobby");
  usernames.set("me", "alison");
  readerProfiles.set("alice", reader("alice"));
  readerProfiles.set("alina", reader("alina"));
  readerProfiles.set("alix", reader("alix"));
  readerProfiles.set("me", reader("me"));
  profiles.set("alice", profileRow("alice"));
  profiles.set("alina", profileRow("alina", { published: 0 }));

  const results = service.searchPeople("me", "ali", 10);
  assert.deepEqual(results.map((r) => r.user.username), ["user-alice", "user-alina", "user-alix"]);
  assert.deepEqual(results.map((r) => r.private), [false, true, true]);
  assert.deepEqual(results.map((r) => r.viewerFollows), [false, false, false]);

  service.follow("me", "alice");
  const after = service.searchPeople("me", "ali", 10);
  assert.deepEqual(after.map((r) => r.viewerFollows), [true, false, false]);

  assert.equal(service.searchPeople("me", "ali", 2).length, 2);
});

test("people search results carry a reader glyph only when published and switched on", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, readerProfiles, usernames, readerGlyphs, readerGlyphCalls } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  usernames.set("bob", "bob");
  readerProfiles.set("alice", reader("alice"));
  readerProfiles.set("bob", reader("bob"));
  profiles.set("alice", profileRow("alice"));
  repo.updateFeedSettings("alice", { ...DEFAULT_FEED_SETTINGS, readerGlyph: true });
  readerGlyphs.set("alice", "star");
  profiles.set("bob", profileRow("bob"));
  repo.updateFeedSettings("bob", { ...DEFAULT_FEED_SETTINGS, readerGlyph: false });

  const aliceResults = service.searchPeople("me", "alice", 10);
  const bobResults = service.searchPeople("me", "bob", 10);
  assert.equal(aliceResults[0]?.user.readerGlyph, "star");
  assert.equal(bobResults[0]?.user.readerGlyph, undefined);
  assert.equal(readerGlyphCalls.includes("bob"), false);
});

test("publishProfile emits mural_published only when the mural changes", () => {
  const { repo, events } = createRepoFake();
  const { deps, usernames, ownedMurals } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  ownedMurals.add("alice:m1");
  ownedMurals.add("alice:m2");
  repo.upsertProfile(profileRow("alice", { mural_id: "m1" }));
  service.publishProfile("alice", { muralId: "m1" });
  assert.equal(events.filter((e) => e.type === "mural_published").length, 0);
  service.publishProfile("alice", { muralId: "m2" });
  const murals = events.filter((e) => e.type === "mural_published");
  assert.equal(murals.length, 1);
  assert.equal(murals[0]?.ref_type, "mural");
  assert.equal(murals[0]?.ref_id, "m2");
});

test("publishing a privately chosen shelf for the first time announces it", () => {
  const { repo, events } = createRepoFake();
  const { deps, usernames, ownedMurals } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  ownedMurals.add("alice:m1");
  service.setShelfMural("alice", "m1");
  service.publishProfile("alice", { muralId: "m1" });
  const announcements = events.filter((event) => event.type === "mural_published");
  assert.equal(announcements.length, 1);
  assert.equal(announcements[0]?.ref_id, "m1");
});

test("choosing a mural on a later publish announces it, though the first publish had none", () => {
  const { repo, events } = createRepoFake();
  const { deps, usernames, ownedMurals } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  ownedMurals.add("alice:m1");
  const announced = () => events.filter((event) => event.type === "mural_published").map((event) => event.ref_id);
  service.publishProfile("alice", {});
  assert.deepEqual(announced(), []);
  service.publishProfile("alice", { muralId: "m1" });
  assert.deepEqual(announced(), ["m1"]);
});

test("republishing the same mural after unpublish stays silent", () => {
  const { repo, events } = createRepoFake();
  const { deps, usernames, ownedMurals } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  ownedMurals.add("alice:m1");
  service.publishProfile("alice", { muralId: "m1" });
  service.unpublishProfile("alice");
  const before = events.filter((event) => event.type === "mural_published").length;
  service.publishProfile("alice", { muralId: "m1" });
  assert.equal(events.filter((event) => event.type === "mural_published").length, before);
});

test("follow emits following once; refollow emits nothing", () => {
  const { repo, events } = createRepoFake();
  const { deps, readerProfiles } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("bob", reader("bob"));
  repo.upsertProfile(profileRow("bob"));
  service.follow("alice", "bob");
  service.unfollow("alice", "bob");
  service.follow("alice", "bob");
  const following = events.filter((e) => e.type === "following");
  assert.equal(following.length, 1);
  assert.equal(following[0]?.ref_id, "bob");
  assert.deepEqual(JSON.parse(following[0]?.payload ?? "null"), { username: "user-bob" });
});

test("getActivity filters categories by feed settings but not for the owner", () => {
  const { repo } = createRepoFake();
  const { deps, usernames } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  repo.upsertProfile(profileRow("alice"));
  repo.updateFeedSettings("alice", { publications: true, reading: false, votes: false, follows: true });
  service.emitEvent("alice", "book_added", "book", "b1", { title: "Dune", status: 0 });
  service.emitEvent("alice", "voted_on", "tournament", "t9", { game: "tournament", name: "X" });
  service.emitEvent("alice", "following", "user", "bob", { username: "mia" });
  const stranger = service.getActivity("alice", undefined, undefined, 20);
  assert.deepEqual(stranger.items.map((i) => i.type), ["following"]);
  const owner = service.getActivity("alice", "alice", undefined, 20);
  assert.equal(owner.items.length, 3);
});

test("getActivity 404s on unknown username and unpublished profile", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, usernames } = createDeps(repo);
  const service = createCommunityService(deps);
  assert.throws(() => service.getActivity("ghost", undefined, undefined, 20), ProfileNotFoundError);
  usernames.set("alice", "alice");
  profiles.set("alice", profileRow("alice", { published: 0 }));
  assert.throws(() => service.getActivity("alice", undefined, undefined, 20), ProfileNotFoundError);
  assert.throws(() => service.getActivity("alice", "me", undefined, 20), ProfileNotFoundError);
});

test("an unparseable activity cursor is a 400-worthy error", () => {
  const { repo } = createRepoFake();
  const { deps, usernames } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  repo.upsertProfile(profileRow("alice"));
  assert.throws(() => service.getActivity("alice", undefined, "###", 20), InvalidCursorError);
});

test("getActivity enriches publications, paginates by cursor, and skips vanished refs", () => {
  const { repo } = createRepoFake();
  const { deps, usernames, tierlistRefs, tournamentRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  repo.upsertProfile(profileRow("alice"));
  tierlistRefs.set("t1", tierRef("t1", "alice"));
  tournamentRefs.set("g1", tournRef("g1", "alice"));
  repo.insertEvent({ id: "e1", user_id: "alice", type: "tierlist_published", ref_type: "tierlist", ref_id: "t1", payload: null, created_at: "2026-09-03T00:00:00.000Z" });
  repo.insertEvent({ id: "e2", user_id: "alice", type: "tournament_published", ref_type: "tournament", ref_id: "g1", payload: null, created_at: "2026-09-02T00:00:00.000Z" });
  repo.insertEvent({ id: "e3", user_id: "alice", type: "tierlist_published", ref_type: "tierlist", ref_id: "gone", payload: null, created_at: "2026-09-01T00:00:00.000Z" });
  const first = service.getActivity("alice", undefined, undefined, 1);
  assert.deepEqual(first.items[0]?.payload, { name: "List t1", href: "/vote/code-t1", detail: "5 books · 2 ballots", covers: [] });
  assert.ok(first.nextCursor);
  const second = service.getActivity("alice", undefined, first.nextCursor!, 1);
  assert.deepEqual(second.items.map((i) => i.id), ["e2"]);
  assert.deepEqual(second.items[0]?.payload, { name: "Cup g1", href: "/arena/g1", detail: "8-book bracket · active", covers: [] });
  assert.equal(second.nextCursor, null);
});

test("getActivity keeps fetching past rows hidden from the viewer", () => {
  const { repo } = createRepoFake();
  const { deps, usernames } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  repo.upsertProfile(profileRow("alice"));
  repo.updateFeedSettings("alice", { publications: true, reading: false, votes: false, follows: true });
  const book = (id: string, ref: string, at: string) =>
    ({ id, user_id: "alice", type: "book_added" as const, ref_type: "book" as const, ref_id: ref, payload: JSON.stringify({ title: "T", status: 0 }), created_at: at });
  repo.insertEvent(book("e1", "b1", "2026-09-05T00:00:00.000Z"));
  repo.insertEvent(book("e2", "b2", "2026-09-04T00:00:00.000Z"));
  repo.insertEvent(book("e3", "b3", "2026-09-03T00:00:00.000Z"));
  repo.insertEvent(book("e4", "b4", "2026-09-02T00:00:00.000Z"));
  repo.insertEvent({ id: "e5", user_id: "alice", type: "following", ref_type: "user", ref_id: "bob", payload: JSON.stringify({ username: "mia" }), created_at: "2026-09-01T00:00:00.000Z" });
  const page = service.getActivity("alice", undefined, undefined, 2);
  assert.deepEqual(page.items.map((i) => i.id), ["e5"]);
  assert.equal(page.nextCursor, null);
  const ownerPage = service.getActivity("alice", "alice", undefined, 2);
  assert.deepEqual(ownerPage.items.map((i) => i.id), ["e1", "e2"]);
  assert.ok(ownerPage.nextCursor);
});

test("dashboard omits publications from actors who disabled them but keeps follow rows", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  readerProfiles.set("alice", reader("alice"));
  readerProfiles.set("bob", reader("bob"));
  readerProfiles.set("carol", reader("carol"));
  repo.upsertProfile(profileRow("alice"));
  repo.upsertProfile(profileRow("bob"));
  repo.updateFeedSettings("alice", { publications: false, reading: false, votes: false, follows: false });
  service.follow("viewer", "alice");
  service.follow("viewer", "bob");
  service.emitEvent("alice", "tierlist_published", "tierlist", "t1");
  service.emitEvent("bob", "tierlist_published", "tierlist", "t2");
  tierlistRefs.set("t1", tierRef("t1", "alice"));
  tierlistRefs.set("t2", tierRef("t2", "bob"));
  repo.insertFollow({ follower_id: "carol", followee_id: "viewer", created_at: "2026-09-07T00:00:00.000Z" });
  const page = service.getDashboard("viewer", undefined, 20);
  assert.deepEqual(
    page.items.map((i) => (i.kind === "publication" ? i.content.id : i.id)),
    ["t2", "carol"]
  );
});

test("dashboard shows a followee's reading and votes only while their switches are on, and their follows and murals never crowd them out", () => {
  const { repo } = createRepoFake();
  const { deps, readerProfiles, tierlistRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  for (const id of ["alice", "bob"]) {
    readerProfiles.set(id, reader(id));
    repo.upsertProfile(profileRow(id));
    repo.insertFollow({ follower_id: "viewer", followee_id: id, created_at: at(1) });
    tierlistRefs.set(`t-${id}`, tierRef(`t-${id}`, "carol"));
    repo.insertEvent({ id: `${id}-added`, user_id: id, type: "book_added", ref_type: "book", ref_id: `${id}-b1`, payload: JSON.stringify({ title: "Dune", author: "Herbert", coverUrl: "https://covers.test/dune.jpg" }), created_at: at(2) });
    repo.insertEvent({ id: `${id}-finished`, user_id: id, type: "book_finished", ref_type: "book", ref_id: `${id}-b2`, payload: JSON.stringify({ title: "Emma", author: "Austen" }), created_at: at(3) });
    repo.insertEvent({ id: `${id}-vote`, user_id: id, type: "voted_on", ref_type: "tierlist", ref_id: `t-${id}`, payload: JSON.stringify({ game: "tierlist" }), created_at: at(4) });
    for (let i = 0; i < 25; i++) {
      const createdAt = `2026-09-05T00:00:${String(i).padStart(2, "0")}.000Z`;
      repo.insertEvent({ id: `${id}-following-${i}`, user_id: id, type: "following", ref_type: "user", ref_id: `${id}-x${i}`, payload: null, created_at: createdAt });
      repo.insertEvent({ id: `${id}-mural-${i}`, user_id: id, type: "mural_published", ref_type: "mural", ref_id: `${id}-m${i}`, payload: null, created_at: createdAt });
    }
  }
  repo.updateFeedSettings("alice", { ...DEFAULT_FEED_SETTINGS, reading: true, votes: false });
  const { items } = service.getDashboard("viewer", undefined, 3);
  assert.deepEqual(items.map((item) => [item.kind, item.id]), [["vote", "bob-vote"], ["reading", "alice-finished"], ["reading", "alice-added"]]);
  assert.deepEqual(items.flatMap((item) => (item.kind === "reading" ? [[item.finished, item.book]] : [])), [
    [true, { title: "Emma", author: "Austen", coverUrl: null }],
    [false, { title: "Dune", author: "Herbert", coverUrl: "https://covers.test/dune.jpg" }]
  ]);
});

test("feed settings round-trip and reach only the owner's profile view", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, usernames, readerProfiles } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  readerProfiles.set("alice", reader("alice"));
  profiles.set("alice", profileRow("alice"));
  assert.deepEqual(service.getFeedSettings("alice"), DEFAULT_FEED_SETTINGS);
  const settings = { publications: false, reading: true, votes: false, follows: true };
  service.updateFeedSettings("alice", settings);
  assert.deepEqual(service.getFeedSettings("alice"), settings);
  assert.deepEqual(service.getProfileByUsername("alice", "alice").feedSettings, settings);
  assert.equal(service.getProfileByUsername("alice", "bob").feedSettings, undefined);
});

test("getLibrary serves a published owner's library and 404s otherwise", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, usernames, libraries } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  usernames.set("bob", "bob");
  libraries.set("alice", { books: [{ Title: "Dune" }] });
  libraries.set("bob", { books: [{ Title: "Emma" }] });
  profiles.set("alice", profileRow("alice"));
  profiles.set("bob", profileRow("bob", { published: 0 }));
  assert.deepEqual(service.getLibrary("alice"), { data: { books: [{ Title: "Dune" }] } });
  assert.throws(() => service.getLibrary("bob"), ProfileNotFoundError);
  assert.throws(() => service.getLibrary("ghost"), ProfileNotFoundError);
});

test("getLibrary reads a published owner with no library as null", () => {
  const { repo, profiles } = createRepoFake();
  const { deps, usernames } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  profiles.set("alice", profileRow("alice"));
  assert.deepEqual(service.getLibrary("alice"), { data: null });
});

test("own profile reports a private shelf without a profiles row", () => {
  const { repo } = createRepoFake();
  const { deps } = createDeps(repo);
  const service = createCommunityService(deps);
  assert.deepEqual(service.getOwnProfile("alice"), { muralId: null, published: false, feedSettings: DEFAULT_FEED_SETTINGS });
});

test("choosing the shelf mural keeps the profile private and checks ownership", () => {
  const { repo } = createRepoFake();
  const { deps, ownedMurals } = createDeps(repo);
  const service = createCommunityService(deps);
  ownedMurals.add("alice:m1");
  assert.throws(() => service.setShelfMural("alice", "m2"), MuralNotOwnedError);
  service.setShelfMural("alice", "m1");
  const row = repo.getProfileRow("alice")!;
  assert.equal(row.published, 0);
  assert.equal(row.mural_id, "m1");
  assert.equal(row.published_at, null);
  assert.deepEqual(service.getOwnProfile("alice"), { muralId: "m1", published: false, feedSettings: DEFAULT_FEED_SETTINGS });
});

test("getOwnProfile clears a dangling muralId once the mural is gone", () => {
  const { repo } = createRepoFake();
  const { deps, ownedMurals } = createDeps(repo);
  const service = createCommunityService(deps);
  ownedMurals.add("alice:m1");
  service.setShelfMural("alice", "m1");
  ownedMurals.delete("alice:m1");
  assert.deepEqual(service.getOwnProfile("alice"), { muralId: null, published: false, feedSettings: DEFAULT_FEED_SETTINGS });
});

test("switching a published shelf announces the new mural once", () => {
  const { repo, events } = createRepoFake();
  const { deps, usernames, ownedMurals } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  ownedMurals.add("alice:m1");
  ownedMurals.add("alice:m2");
  service.publishProfile("alice", { muralId: "m1" });
  const announcements = () => events.filter((event) => event.type === "mural_published").length;
  const before = announcements();
  service.setShelfMural("alice", "m2");
  service.setShelfMural("alice", "m2");
  assert.equal(announcements(), before + 1);
  assert.equal(repo.getProfileRow("alice")!.published, 1);
});

test("owners read their own activity before publishing; visitors still get 404", () => {
  const { repo } = createRepoFake();
  const { deps, usernames, ownedMurals } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  ownedMurals.add("alice:m1");
  service.setShelfMural("alice", "m1");
  assert.doesNotThrow(() => service.getActivity("alice", "alice", undefined, 20));
  assert.throws(() => service.getActivity("alice", "bob", undefined, 20), ProfileNotFoundError);
  assert.throws(() => service.getActivity("alice", undefined, undefined, 20), ProfileNotFoundError);
});

test("getActivity links votes to what was voted on, and leaves vanished ones plain", () => {
  const { repo } = createRepoFake();
  const { deps, usernames, tierlistRefs, tournamentRefs } = createDeps(repo);
  const service = createCommunityService(deps);
  usernames.set("alice", "alice");
  repo.upsertProfile(profileRow("alice"));
  tierlistRefs.set("t1", tierRef("t1", "bob", { covers: ["a", "b", "c", "d"] }));
  tournamentRefs.set("g1", tournRef("g1", "bob", { covers: ["x"] }));
  service.emitEvent("alice", "voted_on", "tierlist", "t1", { game: "tierlist", id: "t1", name: "List t1" });
  service.emitEvent("alice", "voted_on", "tournament", "g1", { game: "tournament", id: "g1", name: "Cup g1" });
  service.emitEvent("alice", "voted_on", "tournament", "gone", { game: "tournament", id: "gone", name: "Old cup" });
  const payloads = Object.fromEntries(service.getActivity("alice", "alice", undefined, 20).items.map((item) => [String(item.payload.id), item.payload]));
  assert.deepEqual(payloads.t1, { game: "tierlist", id: "t1", name: "List t1", covers: ["a", "b", "c"], href: "/vote/code-t1" });
  assert.deepEqual(payloads.g1, { game: "tournament", id: "g1", name: "Cup g1", covers: ["x"], href: "/arena/g1" });
  assert.deepEqual(payloads.gone, { game: "tournament", id: "gone", name: "Old cup" });
});

function suggestionFixture() {
  const { repo } = createRepoFake();
  const { deps, libraries, readerProfiles, readerGlyphs } = createDeps(repo);
  const service = createCommunityService(deps);
  const addReader = (id: string, books: Array<Record<string, unknown>>, updatedAt = at(1)) => {
    readerProfiles.set(id, reader(id));
    libraries.set(id, { books });
    repo.upsertProfile(profileRow(id, { updated_at: updatedAt }));
  };
  const suggested = (limit = 20) => service.suggestPeople("viewer", limit);
  return { repo, service, libraries, readerProfiles, readerGlyphs, addReader, suggested };
}

const shelfBook = (title: string, extra: Record<string, unknown> = {}) => ({ Title: title, Attribution: "A. Writer", ...extra });
const suggestedIds = (people: SuggestedReader[]) => people.map((person) => person.user.userId);
const suggestedCounts = (people: SuggestedReader[]) => people.map((person) => [person.user.userId, person.sharedCount]);

test("suggested readers are ranked by shared books, then by how recently they were active", () => {
  const { libraries, addReader, suggested } = suggestionFixture();
  const shelf = [shelfBook("A"), shelfBook("B"), shelfBook("C")];
  libraries.set("viewer", { books: shelf });
  addReader("one-old", [shelfBook("A")], at(1));
  addReader("one-new", [shelfBook("A")], at(6));
  addReader("three", shelf, at(2));
  addReader("two", [shelfBook("A"), shelfBook("B")], at(3));
  assert.deepEqual(suggestedCounts(suggested()), [["three", 3], ["two", 2], ["one-new", 1], ["one-old", 1]]);
});

test("a book matches on ISBN even when the titles differ, and on title and author when one side has no ISBN", () => {
  const { libraries, addReader, suggested } = suggestionFixture();
  libraries.set("viewer", { books: [{ Title: "Dune", Attribution: "Frank Herbert", ISBN: "9780441172719" }, { Title: "Emma", Attribution: "Jane Austen" }] });
  addReader("by-isbn", [{ Title: "Dune (Deluxe Edition)", Attribution: "F. Herbert", ISBN: "978-0-441-17271-9" }], at(3));
  addReader("by-title", [{ Title: " EMMA ", Attribution: "Jane  Austen", ISBN: "9780141439587" }], at(2));
  addReader("neither", [{ Title: "Emma", Attribution: "Someone Else", ISBN: "9780000000002" }], at(1));
  assert.deepEqual(suggestedCounts(suggested()), [["by-isbn", 1], ["by-title", 1], ["neither", 0]]);
});

test("suggested readers leave out the viewer, people they follow, unpublished readers and readers with no profile", () => {
  const { repo, libraries, addReader, suggested } = suggestionFixture();
  const shelf = [shelfBook("A")];
  addReader("viewer", shelf, at(6));
  addReader("followed", shelf, at(5));
  addReader("unpublished", shelf, at(4));
  addReader("stranger", shelf, at(3));
  addReader("follower", shelf, at(2));
  repo.upsertProfile(profileRow("unpublished", { published: 0, updated_at: at(4) }));
  repo.insertFollow({ follower_id: "viewer", followee_id: "followed", created_at: at(7) });
  repo.insertFollow({ follower_id: "follower", followee_id: "viewer", created_at: at(7) });
  libraries.set("nameless", { books: shelf });
  repo.upsertProfile(profileRow("nameless", { updated_at: at(8) }));
  assert.deepEqual(suggestedIds(suggested()), ["stranger", "follower"]);
});

test("fewer than five overlapping readers are topped up with recently active ones, newest first", () => {
  const { libraries, addReader, suggested } = suggestionFixture();
  libraries.set("viewer", { books: [shelfBook("A")] });
  addReader("match", [shelfBook("A")], at(1));
  addReader("quiet", [], at(2));
  addReader("busy", [shelfBook("Z")], at(9));
  addReader("fresh", [], at(5));
  assert.deepEqual(suggestedCounts(suggested()), [["match", 1], ["busy", 0], ["fresh", 0], ["quiet", 0]]);
});

test("the top-up stops once five readers overlap", () => {
  const { libraries, addReader, suggested } = suggestionFixture();
  libraries.set("viewer", { books: [shelfBook("A")] });
  for (let n = 1; n <= 4; n++) addReader(`match-${n}`, [shelfBook("A")], at(n));
  addReader("other", [], at(9));
  assert.deepEqual(suggestedIds(suggested()), ["match-4", "match-3", "match-2", "match-1", "other"]);
  addReader("match-5", [shelfBook("A")], at(5));
  assert.deepEqual(suggestedIds(suggested()), ["match-5", "match-4", "match-3", "match-2", "match-1"]);
});

test("a missing, malformed or junk-padded library never breaks suggestions", () => {
  const { repo, libraries, readerProfiles, addReader, suggested } = suggestionFixture();
  libraries.set("viewer", { books: [null, 7, shelfBook("A")] });
  addReader("padded", [], at(4));
  libraries.set("padded", { books: [null, 7, shelfBook("A")] });
  addReader("malformed", [], at(3));
  libraries.set("malformed", { books: "none" });
  readerProfiles.set("absent", reader("absent"));
  repo.upsertProfile(profileRow("absent", { updated_at: at(2) }));
  assert.deepEqual(suggestedCounts(suggested()), [["padded", 1], ["malformed", 0], ["absent", 0]]);
});

test("a viewer with no library is shown recently active readers", () => {
  const { addReader, suggested } = suggestionFixture();
  addReader("older", [shelfBook("A")], at(1));
  addReader("newer", [shelfBook("B")], at(2));
  assert.deepEqual(suggestedCounts(suggested()), [["newer", 0], ["older", 0]]);
});

test("a suggestion lists up to three shared books, with covers from the reader's own library", () => {
  const { libraries, addReader, suggested } = suggestionFixture();
  libraries.set("viewer", { books: ["A", "B", "C", "D"].map((title) => shelfBook(title, { _coverUrl: "https://covers.test/viewer.jpg" })) });
  addReader("reader", [shelfBook("A", { _coverUrl: "https://covers.test/a.jpg" }), shelfBook("B"), shelfBook("C", { _coverUrl: null }), shelfBook("D", { _coverUrl: "https://covers.test/d.jpg" })]);
  const [suggestion] = suggested();
  assert.equal(suggestion?.sharedCount, 4);
  assert.deepEqual(suggestion?.sharedBooks, [
    { title: "A", author: "A. Writer", coverUrl: "https://covers.test/a.jpg" },
    { title: "B", author: "A. Writer", coverUrl: null },
    { title: "C", author: "A. Writer", coverUrl: null }
  ]);
});

test("suggested readers stop at the limit, overlapping ones first", () => {
  const { libraries, addReader, suggested } = suggestionFixture();
  libraries.set("viewer", { books: [shelfBook("A"), shelfBook("B")] });
  addReader("one", [shelfBook("A")], at(1));
  addReader("two", [shelfBook("A"), shelfBook("B")], at(2));
  addReader("none", [], at(3));
  assert.deepEqual(suggestedIds(suggested(1)), ["two"]);
  assert.deepEqual(suggestedIds(suggested(2)), ["two", "one"]);
  assert.deepEqual(suggestedIds(suggested(3)), ["two", "one", "none"]);
});

test("a suggestion carries the card fields and the follower count, and a reader glyph only when switched on", () => {
  const { repo, libraries, readerGlyphs, addReader, suggested } = suggestionFixture();
  libraries.set("viewer", { books: [shelfBook("A")] });
  addReader("glyphed", [shelfBook("A")], at(2));
  addReader("plain", [shelfBook("A")], at(1));
  repo.updateFeedSettings("glyphed", { ...DEFAULT_FEED_SETTINGS, readerGlyph: true });
  readerGlyphs.set("glyphed", "star");
  readerGlyphs.set("plain", "star");
  repo.insertFollow({ follower_id: "fan", followee_id: "glyphed", created_at: at(3) });
  const [glyphed, plain] = suggested();
  assert.deepEqual(glyphed, {
    user: { username: "user-glyphed", avatarUrl: null, userId: "glyphed", readerGlyph: "star" },
    followerCount: 1,
    viewerFollows: false,
    private: false,
    sharedCount: 1,
    sharedBooks: [{ title: "A", author: "A. Writer", coverUrl: null }]
  });
  assert.equal(plain?.user.readerGlyph, undefined);
});

test("suggested readers scan at most the 500 most recently active published profiles", () => {
  const { repo, suggested } = suggestionFixture();
  const requested: number[] = [];
  const listPublishedProfiles = repo.listPublishedProfiles;
  repo.listPublishedProfiles = (limit) => {
    requested.push(limit);
    return listPublishedProfiles(limit);
  };
  suggested();
  assert.deepEqual(requested, [500]);
});
