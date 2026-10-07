import type { ActivityEventType, FeedSettings } from "@scripta/shared/community";
import type { EventRow, FollowRow, ProfileRow } from "./types.js";

export interface VisibilityRow {
  user_id: string;
  published: number;
  show_publications: number;
  show_reading: number;
  show_votes: number;
  show_follows: number;
  show_reader_glyph: number;
}

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
  listFollowerIds(followeeId: string): string[];
  listFollowersByFollowee(followeeId: string, keyset: CursorKeyset | undefined, limit: number): FollowRow[];
  listFollowersSince(followeeId: string, since: string, limit: number): FollowRow[];
  countFollowers(userId: string): number;
  countFollowing(userId: string): number;

  getProfileRow(userId: string): ProfileRow | undefined;
  upsertProfile(row: ProfileRow): void;
  listPublishedProfiles(limit: number): ProfileRow[];
  getFeedSettings(userId: string): FeedSettings | null;
  updateFeedSettings(userId: string, settings: FeedSettings): void;
  visibilityRows(userIds: string[]): VisibilityRow[];

  insertEvent(row: EventRow): void;
  countEventsSince(userId: string, since: string, types: readonly ActivityEventType[], limit: number): number;
  listEventsByUser(userId: string, keyset: CursorKeyset | undefined, limit: number, hiddenTypes: readonly ActivityEventType[]): EventRow[];
  listHistoryEventsByUser(userId: string, keyset: CursorKeyset | undefined, limit: number, hiddenTypes: readonly ActivityEventType[]): EventRow[];
  listInbox(viewerId: string, keyset: CursorKeyset | undefined, limit: number, types: readonly ActivityEventType[]): EventRow[];
  countInboxSince(viewerId: string, since: string, types: readonly ActivityEventType[], limit: number): number;
  moveEventsBefore(cutoff: string, batch: number): number;
  purgeInboxBefore(cutoff: string, batch: number): number;
  backfillInbox(authorId: string, followerIds: readonly string[], types: readonly ActivityEventType[], since: string): void;
}
