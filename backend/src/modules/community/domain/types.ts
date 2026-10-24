import type { ActivityEventType } from "@scripta/shared/community";
import type { GameKind } from "./games.js";

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
  feed_settings: string | null;
}

export type CommunityRefType = GameKind | "book" | "user" | "mural";

export interface EventRow {
  id: string;
  user_id: string;
  type: ActivityEventType;
  ref_type: CommunityRefType;
  ref_id: string;
  payload: string | null;
  created_at: string;
  trace_id?: string | null;
  source?: string | null;
}
