import { randomUUID } from "node:crypto";
import type { ReaderProfile } from "@scripta/shared";
import { decodeCursor, encodeCursor } from "@scripta/shared/community";
import type { CommunityEventType, DiscoverItem, DiscoverType, FeedItem, FollowState, Page, PersonResult, PublishedContent, PublishedProfile, TierlistSummary, TournamentSummary } from "@scripta/shared/community";
import type { PublishedTournamentRef } from "../arena/service.js";
import type { MuralsPublicApi } from "../murals/publicApi.js";
import type { MuralPublicPayload } from "../murals/index.js";
import type { PublishedTierlistRef } from "../tierlists/service.js";
import { InvalidCursorError, MuralNotOwnedError, NotFollowingError, ProfileNotFoundError, SelfFollowError, UsernameRequiredError } from "./domain/errors.js";
import type { CommunityRepository } from "./domain/ports.js";
import type { EventRow } from "./domain/types.js";

const DISCOVER_SCAN_CAP = 500;

export type CommunityRefType = "tierlist" | "tournament";

export interface PublicProfileView {
  profile: PublishedProfile;
  mural: MuralPublicPayload | null;
  published: { tierlists: TierlistSummary[]; tournaments: TournamentSummary[] };
}

function toTierlistSummary(ref: PublishedTierlistRef): TierlistSummary {
  return { kind: "tierlist", id: ref.id, voteCode: ref.voteCode, name: ref.name, poolSize: ref.poolSize, ballotCount: ref.ballotCount, votingOpen: ref.votingOpen };
}

function toTournamentSummary(ref: PublishedTournamentRef): TournamentSummary {
  return { kind: "tournament", id: ref.id, name: ref.name, bracketSize: ref.bracketSize, status: ref.status, bookCount: ref.bracketSize };
}

function byNewestFirst(a: EventRow, b: EventRow): number {
  if (a.created_at !== b.created_at) return b.created_at.localeCompare(a.created_at);
  return a.id < b.id ? 1 : -1;
}

export interface CommunityDeps {
  repo: CommunityRepository;
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
  getFeed(viewerId: string, cursor: string | undefined, limit: number): Page<FeedItem>;
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
      repo.insertEvent({ id: randomUUID(), user_id: userId, type, ref_type: refType, ref_id: refId, created_at: new Date().toISOString() });
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
        updated_at: now
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
    getFeed(viewerId, cursor, limit) {
      const keyset = cursor ? decodeCursor(cursor) : undefined;
      if (cursor && !keyset) throw new InvalidCursorError();
      const collected: EventRow[] = [];
      for (const followeeId of repo.listFollowees(viewerId)) {
        collected.push(...repo.listEventsByUser(followeeId, keyset, limit + 1));
      }
      collected.sort(byNewestFirst);
      const items: FeedItem[] = [];
      let nextCursor: string | null = null;
      for (const event of collected) {
        if (items.length === limit) {
          const last = items[items.length - 1];
          if (last) nextCursor = encodeCursor({ createdAt: last.createdAt, id: last.id });
          break;
        }
        if (event.ref_type === "tierlist") {
          const ref = deps.tierlists.get(event.ref_id);
          const actor = ref && ref.ownerUserId === event.user_id ? deps.resolveProfiles([event.user_id]).get(event.user_id) : undefined;
          if (ref && actor) {
            items.push({ id: event.id, actor: { ...actor, userId: event.user_id }, type: event.type, content: toTierlistSummary(ref), createdAt: event.created_at });
          }
        } else {
          const ref = deps.tournaments.get(event.ref_id);
          const actor = ref && ref.ownerUserId === event.user_id ? deps.resolveProfiles([event.user_id]).get(event.user_id) : undefined;
          if (ref && actor) {
            items.push({ id: event.id, actor: { ...actor, userId: event.user_id }, type: event.type, content: toTournamentSummary(ref), createdAt: event.created_at });
          }
        }
      }
      return { items, nextCursor };
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
          const author = authors.get(entry.userId);
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
      repo.insertEvent({ id: randomUUID(), user_id: userId, type, ref_type: refType, ref_id: refId, created_at: new Date().toISOString() });
    }
  };
}
