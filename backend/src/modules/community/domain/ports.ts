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
  countFollowers(userId: string): number;
  countFollowing(userId: string): number;

  getProfileRow(userId: string): ProfileRow | undefined;
  upsertProfile(row: ProfileRow): void;

  insertEvent(row: EventRow): void;
  listEventsByUser(userId: string, keyset: CursorKeyset | undefined, limit: number): EventRow[];
}
