import type {
  DiscoverItem,
  DiscoverType,
  FeedItem,
  Page,
  PersonResult,
  PublishedProfile,
  TierlistSummary,
  TournamentSummary
} from "@scripta/shared/community";
import type { MuralBlock, ShelfTheme } from "../lib/murals";
import { apiFetch } from "./client";
import type { PublicBookData, PublicHighlight } from "./sharedMurals";
import type { ResolvedTierlist } from "./tierlists";

export interface CommunityProfileView {
  profile: PublishedProfile;
  mural: {
    mural: { id: string; name: string; blocks: MuralBlock[]; coverImageUrl: string | null };
    library: {
      books: PublicBookData[];
      highlights: PublicHighlight[];
      currentlyReading: PublicBookData[];
      stats: Record<string, number>;
      shelfTheme?: ShelfTheme;
    };
    imageUrls: Record<string, string | null>;
    tierlists: Record<string, ResolvedTierlist>;
  } | null;
  published: { tierlists: TierlistSummary[]; tournaments: TournamentSummary[] };
}

export async function fetchFeed(cursor?: string): Promise<Page<FeedItem>> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return (await apiFetch(`/community/feed${query}`)) as Page<FeedItem>;
}

export async function fetchDiscover(type: DiscoverType, q: string, offset = 0): Promise<{ items: DiscoverItem[]; nextOffset: number | null }> {
  const params = new URLSearchParams({ type, q, offset: String(offset) });
  return (await apiFetch(`/community/discover?${params}`)) as { items: DiscoverItem[]; nextOffset: number | null };
}

export async function fetchPeople(q: string): Promise<PersonResult[]> {
  const body = (await apiFetch(`/community/people?q=${encodeURIComponent(q)}`)) as { people: PersonResult[] };
  return body.people;
}

export async function fetchCommunityProfile(username: string): Promise<CommunityProfileView> {
  return (await apiFetch(`/community/profiles/${encodeURIComponent(username)}`)) as CommunityProfileView;
}

export async function followUser(userId: string): Promise<void> {
  await apiFetch("/community/follows", { method: "POST", body: JSON.stringify({ userId }) });
}

export async function unfollowUser(userId: string): Promise<void> {
  await apiFetch(`/community/follows/${userId}`, { method: "DELETE" });
}

export async function publishProfile(muralId: string): Promise<void> {
  await apiFetch("/community/profile/publish", { method: "PUT", body: JSON.stringify({ muralId }) });
}

export async function unpublishProfile(): Promise<void> {
  await apiFetch("/community/profile/publish", { method: "DELETE" });
}
