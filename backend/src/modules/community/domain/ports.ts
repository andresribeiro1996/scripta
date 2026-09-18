import type { FeedSettings } from "@scripta/shared/community";
import type { EventRow, FollowRow, ProfileRow } from "./types.js";

export interface CursorKeyset {
  createdAt: string;
  id: string;
}

export interface CommunityRepository {
  insertFollow(row: FollowRow): void;
  deleteFollow(followerId: string, followeeId: string): boolean;
  getFollow(followerId: string, followeeId: string): FollowRow | undefined;
  listFollowees(followerId: string): string[];
  listFollowersByFollowee(followeeId: string, keyset: CursorKeyset | undefined, limit: number): FollowRow[];
  countFollowers(userId: string): number;
  countFollowing(userId: string): number;
  countEventsByUsersSince(userIds: string[], since: string): number;
  countFollowersSince(followeeId: string, since: string): number;

  getProfileRow(userId: string): ProfileRow | undefined;
  upsertProfile(row: ProfileRow): void;
  getFeedSettings(userId: string): FeedSettings | null;
  updateFeedSettings(userId: string, settings: FeedSettings): void;

  insertEvent(row: EventRow): void;
  listEventsByUser(userId: string, keyset: CursorKeyset | undefined, limit: number): EventRow[];
}
