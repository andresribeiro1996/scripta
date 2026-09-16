import { randomUUID } from "node:crypto";
import type { ReaderProfile } from "@scripta/shared";
import type { CommunityEventType, FollowState, PublishedProfile, TierlistSummary, TournamentSummary } from "@scripta/shared/community";
import type { PublishedTournamentRef } from "../arena/service.js";
import type { MuralsPublicApi } from "../murals/publicApi.js";
import type { MuralPublicPayload } from "../murals/index.js";
import type { PublishedTierlistRef } from "../tierlists/service.js";
import { MuralNotOwnedError, NotFollowingError, ProfileNotFoundError, SelfFollowError, UsernameRequiredError } from "./domain/errors.js";
import type { CommunityRepository } from "./domain/ports.js";

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
    }
  };
}
