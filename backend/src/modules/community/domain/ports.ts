import type { ActivityEventType, FeedSettings } from "@scripta/shared/community";
import type { EventRow, FollowRow, ProfileRow } from "./types.js";

export interface CursorKeyset {
  createdAt: string;
  id: string;
}

export interface CommunityRepository {
  deleteUserData(userId: string): void;
  insertFollow(row: FollowRow): boolean;
  deleteFollow(followerId: string, followeeId: string): boolean;
  getFollow(followerId: string, followeeId: string): FollowRow | undefined;
  listFollowees(followerId: string): string[];
  listFollowersByFollowee(followeeId: string, keyset: CursorKeyset | undefined, limit: number): FollowRow[];
  listFollowersSince(followeeId: string, since: string, limit: number): FollowRow[];
  countFollowers(userId: string): number;
  countFollowing(userId: string): number;

  getProfileRow(userId: string): ProfileRow | undefined;
  upsertProfile(row: ProfileRow): void;
  listPublishedProfiles(limit: number): ProfileRow[];
  getFeedSettings(userId: string): FeedSettings | null;
  updateFeedSettings(userId: string, settings: FeedSettings): void;

  insertEvent(row: EventRow): void;
  listEventsByUser(userId: string, keyset: CursorKeyset | undefined, limit: number): EventRow[];
  listHistoryEventsByUser(userId: string, keyset: CursorKeyset | undefined, limit: number): EventRow[];
  listInbox(viewerId: string, keyset: CursorKeyset | undefined, limit: number, types: readonly ActivityEventType[]): EventRow[];
  countInboxSince(viewerId: string, since: string, types: readonly ActivityEventType[], limit: number): number;
  moveEventsBefore(cutoff: string, batch: number): number;
  purgeInboxBefore(cutoff: string, batch: number): number;
}
