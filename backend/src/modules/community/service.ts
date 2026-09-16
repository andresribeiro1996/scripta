import { randomUUID } from "node:crypto";
import type { ReaderProfile } from "@scripta/shared";
import type { CommunityEventType, FollowState } from "@scripta/shared/community";
import type { PublishedTournamentRef } from "../arena/service.js";
import type { MuralsPublicApi } from "../murals/publicApi.js";
import type { MuralPublicPayload } from "../murals/index.js";
import type { PublishedTierlistRef } from "../tierlists/service.js";
import { NotFollowingError, ProfileNotFoundError, SelfFollowError } from "./domain/errors.js";
import type { CommunityRepository } from "./domain/ports.js";

export type CommunityRefType = "tierlist" | "tournament";

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
    }
  };
}
