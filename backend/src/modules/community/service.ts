import { randomUUID } from "node:crypto";
import type { ReaderProfile } from "@scripta/shared";
import { decodeCursor, encodeCursor } from "@scripta/shared/community";
import type { CommunityEventType, DiscoverItem, DiscoverType, FollowState, PersonResult, PublishedContent, PublishedProfile, TierlistSummary, TournamentSummary } from "@scripta/shared/community";
import type { DashboardFeedPage, DigestItem } from "@scripta/shared/dashboard";
import type { PublishedTournamentRef } from "../arena/service.js";
import type { MuralsPublicApi } from "../murals/publicApi.js";
import type { MuralPublicPayload } from "../murals/index.js";
import type { PublishedTierlistRef } from "../tierlists/service.js";
import { InvalidCursorError, MuralNotOwnedError, NotFollowingError, ProfileNotFoundError, SelfFollowError, UsernameRequiredError } from "./domain/errors.js";
import type { CommunityRepository } from "./domain/ports.js";
import type { EventRow, FollowRow } from "./domain/types.js";

const DISCOVER_SCAN_CAP = 500;

export type CommunityRefType = "tierlist" | "tournament";

export interface PublicProfileView {
  profile: PublishedProfile;
  mural: MuralPublicPayload | null;
  published: { tierlists: TierlistSummary[]; tournaments: TournamentSummary[] };
}

function toTierlistSummary(ref: PublishedTierlistRef): TierlistSummary {
  return { kind: "tierlist", id: ref.id, voteCode: ref.voteCode, name: ref.name, poolSize: ref.poolSize, ballotCount: ref.ballotCount, votingOpen: ref.votingOpen, promotedAt: ref.promotedAt };
}

function toTournamentSummary(ref: PublishedTournamentRef): TournamentSummary {
  return { kind: "tournament", id: ref.id, name: ref.name, bracketSize: ref.bracketSize, status: ref.status, bookCount: ref.bracketSize };
}

export interface CommunityDeps {
  repo: CommunityRepository;
  getDashboardSeenAt(userId: string): string | null;
  setDashboardSeenAt(userId: string, seenAt: string): void;
  resolveProfile(userId: string): ReaderProfile | undefined;
  resolveProfiles(userIds: string[]): Map<string, ReaderProfile>;
  userHasUsername(userId: string): boolean;
  findUserIdByUsername(username: string): string | undefined;
  searchUsernameOwners(query: string, limit: number): string[];
  murals: Pick<MuralsPublicApi, "ownsMural" | "getMuralPublicPayload">;
  tierlists: {
    list(limit: number, offset: number): PublishedTierlistRef[];
    get(id: string): PublishedTierlistRef | undefined;
    listByOwner(ownerUserId: string): PublishedTierlistRef[];
  };
  tournaments: {
    list(limit: number, offset: number): PublishedTournamentRef[];
    get(id: string): PublishedTournamentRef | undefined;
    listByOwner(ownerUserId: string): PublishedTournamentRef[];
  };
}

export interface CommunityService {
  follow(followerId: string, followeeId: string): void;
  unfollow(followerId: string, followeeId: string): void;
  getFollowState(viewerId: string, userId: string): FollowState;
  emitEvent(userId: string, type: CommunityEventType, refType: CommunityRefType, refId: string): void;
  publishProfile(userId: string, muralId: string): void;
  unpublishProfile(userId: string): void;
  getProfileByUsername(username: string, viewerId?: string): PublicProfileView;
  getDashboard(viewerId: string, cursor: string | undefined, limit: number): DashboardFeedPage;
  markDashboardSeen(viewerId: string): void;
  getDiscover(type: DiscoverType, q: string, limit: number, offset: number): { items: DiscoverItem[]; nextOffset: number | null };
  searchPeople(viewerId: string, q: string, limit: number): PersonResult[];
}

export function createCommunityService(deps: CommunityDeps): CommunityService {
  const { repo } = deps;
  return {
    follow(followerId, followeeId) {
      if (followerId === followeeId) throw new SelfFollowError();
      const row = repo.getProfileRow(followeeId);
      if (!row || row.published !== 1) throw new ProfileNotFoundError();
      repo.insertFollow({ follower_id: followerId, followee_id: followeeId, created_at: new Date().toISOString() });
    },
    unfollow(followerId, followeeId) {
      if (!repo.deleteFollow(followerId, followeeId)) throw new NotFollowingError();
    },
    getFollowState(viewerId, userId) {
      return {
        following: repo.getFollow(viewerId, userId) !== undefined,
        followerCount: repo.countFollowers(userId),
        followingCount: repo.countFollowing(userId)
      };
    },
    emitEvent(userId, type, refType, refId) {
      repo.insertEvent({ id: randomUUID(), user_id: userId, type, ref_type: refType, ref_id: refId, payload: null, created_at: new Date().toISOString() });
    },
    publishProfile(userId, muralId) {
      if (!deps.userHasUsername(userId)) throw new UsernameRequiredError();
      if (!deps.murals.ownsMural(userId, muralId)) throw new MuralNotOwnedError();
      const existing = repo.getProfileRow(userId);
      const now = new Date().toISOString();
      repo.upsertProfile({
        user_id: userId,
        published: 1,
        mural_id: muralId,
        published_at: existing?.published_at ?? now,
        updated_at: now,
        feed_settings: existing?.feed_settings ?? null
      });
    },
    unpublishProfile(userId) {
      const existing = repo.getProfileRow(userId);
      if (!existing) return;
      repo.upsertProfile({ ...existing, published: 0, updated_at: new Date().toISOString() });
    },
    getProfileByUsername(username, viewerId) {
      const userId = deps.findUserIdByUsername(username);
      if (!userId) throw new ProfileNotFoundError();
      const row = repo.getProfileRow(userId);
      if (!row || row.published !== 1) throw new ProfileNotFoundError();
      const author = deps.resolveProfiles([userId]).get(userId);
      if (!author) throw new ProfileNotFoundError();
      const mural = row.mural_id ? deps.murals.getMuralPublicPayload(userId, row.mural_id) : null;
      return {
        profile: {
          user: { ...author, userId },
          publishedAt: row.published_at ?? row.updated_at,
          followerCount: repo.countFollowers(userId),
          followingCount: repo.countFollowing(userId),
          viewerFollows: viewerId ? repo.getFollow(viewerId, userId) !== undefined : undefined
        },
        mural,
        published: {
          tierlists: deps.tierlists.listByOwner(userId).map(toTierlistSummary),
          tournaments: deps.tournaments.listByOwner(userId).map(toTournamentSummary)
        }
      };
    },
    getDashboard(viewerId, cursor, limit) {
      const keyset = cursor ? decodeCursor(cursor) : undefined;
      if (cursor && !keyset) throw new InvalidCursorError();
      type Row = { id: string; createdAt: string; event?: EventRow; follow?: FollowRow };
      const rows: Row[] = [];
      const followees = repo.listFollowees(viewerId);
      for (const followeeId of followees) {
        rows.push(...repo.listEventsByUser(followeeId, keyset, limit + 1).map((event) => ({ id: event.id, createdAt: event.created_at, event })));
      }
      rows.push(...repo.listFollowersByFollowee(viewerId, keyset, limit + 1).map((follow) => ({ id: follow.follower_id, createdAt: follow.created_at, follow })));
      rows.sort((a, b) => (a.createdAt !== b.createdAt ? b.createdAt.localeCompare(a.createdAt) : a.id < b.id ? 1 : -1));
      const actorIds = new Set<string>();
      for (const row of rows) {
        if (row.event) actorIds.add(row.event.user_id);
        if (row.follow) actorIds.add(row.follow.follower_id);
      }
      const profiles = deps.resolveProfiles([...actorIds]);
      const items: DigestItem[] = [];
      let nextCursor: string | null = null;
      let lastIncluded: Row | undefined;
      for (const row of rows) {
        if (items.length === limit) {
          if (lastIncluded) nextCursor = encodeCursor({ createdAt: lastIncluded.createdAt, id: lastIncluded.id });
          break;
        }
        if (row.event) {
          const event = row.event;
          if (event.ref_type === "tierlist") {
            const ref = deps.tierlists.get(event.ref_id);
            const actor = ref && ref.ownerUserId === event.user_id ? profiles.get(event.user_id) ?? (ref.promotedAt ? { username: "Original creator unavailable", avatarUrl: null, unavailable: true } : undefined) : undefined;
            if (ref && actor) {
              items.push({ kind: "publication", id: event.id, actor: { ...actor, userId: event.user_id }, type: event.type as CommunityEventType, content: toTierlistSummary(ref), createdAt: event.created_at });
              lastIncluded = row;
            }
          } else {
            const ref = deps.tournaments.get(event.ref_id);
            const actor = ref && ref.ownerUserId === event.user_id ? profiles.get(event.user_id) : undefined;
            if (ref && actor) {
              items.push({ kind: "publication", id: event.id, actor: { ...actor, userId: event.user_id }, type: event.type as CommunityEventType, content: toTournamentSummary(ref), createdAt: event.created_at });
              lastIncluded = row;
            }
          }
        } else if (row.follow) {
          const author = profiles.get(row.follow.follower_id);
          if (author) {
            items.push({ kind: "follow", id: row.follow.follower_id, actor: { ...author, userId: row.follow.follower_id }, createdAt: row.follow.created_at });
            lastIncluded = row;
          }
        }
      }
      const seen = keyset ? null : deps.getDashboardSeenAt(viewerId);
      const newCount = !keyset && seen ? repo.countEventsByUsersSince(followees, seen) + repo.countFollowersSince(viewerId, seen) : 0;
      return { items, nextCursor, newCount };
    },
    markDashboardSeen(viewerId) {
      deps.setDashboardSeenAt(viewerId, new Date().toISOString());
    },
    getDiscover(type, q, limit, offset) {
      const needle = q.trim().toLowerCase();
      const window = Math.min(offset + limit, DISCOVER_SCAN_CAP);
      const entries: Array<{ userId: string; content: PublishedContent; createdAt: string }> = [];
      if (type !== "tournament") {
        for (const ref of deps.tierlists.list(window, 0)) entries.push({ userId: ref.ownerUserId, content: toTierlistSummary(ref), createdAt: ref.createdAt });
      }
      if (type !== "tierlist") {
        for (const ref of deps.tournaments.list(window, 0)) entries.push({ userId: ref.ownerUserId, content: toTournamentSummary(ref), createdAt: ref.createdAt });
      }
      const authors = deps.resolveProfiles([...new Set(entries.map((e) => e.userId))]);
      const visible = entries
        .flatMap((entry) => {
          const author = authors.get(entry.userId) ?? (entry.content.kind === "tierlist" && entry.content.promotedAt ? { username: "Original creator unavailable", avatarUrl: null, unavailable: true } : undefined);
          if (!author) return [];
          if (needle && !entry.content.name.toLowerCase().includes(needle)) return [];
          return [{ userId: entry.userId, author, content: entry.content, createdAt: entry.createdAt }];
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return {
        items: visible.slice(offset, offset + limit).map(({ userId, author, content }) => ({ author: { ...author, userId }, content })),
        nextOffset: offset + limit < visible.length ? offset + limit : null
      };
    },
    searchPeople(viewerId, q, limit) {
      const needle = q.trim();
      if (!needle) return [];
      const candidates = deps.searchUsernameOwners(needle, limit * 2).filter((id) => id !== viewerId);
      const visible = candidates.filter((id) => repo.getProfileRow(id)?.published === 1).slice(0, limit);
      const authors = deps.resolveProfiles(visible);
      return visible.flatMap((id) => {
        const user = authors.get(id);
        if (!user) return [];
        return [{ user: { ...user, userId: id }, followerCount: repo.countFollowers(id), viewerFollows: repo.getFollow(viewerId, id) !== undefined }];
      });
    }
  };
}

export interface CommunityPublicApi {
  emitEvent(userId: string, type: CommunityEventType, refType: CommunityRefType, refId: string): void;
}

export function createCommunityPublicApi(repo: CommunityRepository): CommunityPublicApi {
  return {
    emitEvent(userId, type, refType, refId) {
      repo.insertEvent({ id: randomUUID(), user_id: userId, type, ref_type: refType, ref_id: refId, payload: null, created_at: new Date().toISOString() });
    }
  };
}
