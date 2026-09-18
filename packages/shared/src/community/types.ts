import type { ReaderProfile } from "../murals/murals.js";

export type CommunityAuthor = ReaderProfile & { userId: string; unavailable?: boolean };

export interface FollowState {
  following: boolean;
  followerCount: number;
  followingCount: number;
}

export interface TierlistSummary {
  kind: "tierlist";
  id: string;
  voteCode: string;
  name: string;
  poolSize: number;
  ballotCount: number;
  votingOpen: boolean;
  promotedAt: string | null;
}

export interface TournamentSummary {
  kind: "tournament";
  id: string;
  name: string;
  bracketSize: number;
  status: "active" | "completed";
  bookCount: number;
}

export type PublishedContent = TierlistSummary | TournamentSummary;

export type CommunityEventType = "tierlist_published" | "tournament_published";

export type DiscoverType = "all" | "tierlist" | "tournament";

export interface FeedItem {
  id: string;
  actor: CommunityAuthor;
  type: CommunityEventType;
  content: PublishedContent;
  createdAt: string;
}

export interface DiscoverItem {
  author: CommunityAuthor;
  content: PublishedContent;
}

export interface PersonResult {
  user: CommunityAuthor;
  followerCount: number;
  viewerFollows?: boolean;
}

export interface PublishedProfile {
  user: CommunityAuthor;
  publishedAt: string;
  followerCount: number;
  followingCount: number;
  viewerFollows?: boolean;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export type ActivityEventType =
  | CommunityEventType
  | "book_added"
  | "book_finished"
  | "following"
  | "mural_published"
  | "voted_on";

export interface ActivityItem {
  id: string;
  type: ActivityEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type FeedCategory = "publications" | "reading" | "votes" | "follows";

export interface FeedSettings {
  publications: boolean;
  reading: boolean;
  votes: boolean;
  follows: boolean;
}

export interface BookRecommendationInput {
  title: string;
  author: string;
  isbn?: string | null;
  coverUrl?: string | null;
  readStatus: 0 | 1 | 2;
}
