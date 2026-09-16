import type { CommunityEventType } from "@scripta/shared/community";

export interface FollowRow {
  follower_id: string;
  followee_id: string;
  created_at: string;
}

export interface ProfileRow {
  user_id: string;
  published: number;
  mural_id: string | null;
  published_at: string | null;
  updated_at: string;
}

export type CommunityRefType = "tierlist" | "tournament";

export interface EventRow {
  id: string;
  user_id: string;
  type: CommunityEventType;
  ref_type: CommunityRefType;
  ref_id: string;
  created_at: string;
}
