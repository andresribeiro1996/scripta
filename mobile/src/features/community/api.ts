import type { LibraryData, MuralBlock, ResolvedTierlist, ShelfTheme } from "@scripta/shared";
import type { DashboardFeedPage } from "@scripta/shared/dashboard";
import type {
  ActivityItem,
  DiscoverItem,
  DiscoverType,
  FeedSettings,
  Page,
  PersonResult,
  PublishedProfile,
  TierlistSummary,
  TournamentSummary,
} from "@scripta/shared/community";
import { apiClient } from "../../core/api";
import type { PublicBookData, PublicHighlight } from "../public/api";

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
  feedSettings?: FeedSettings;
}

export type CommunityPage<T> = Page<T>;

export async function fetchDashboard(cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiClient.request<DashboardFeedPage>(`/community/dashboard${query}`, { auth: true });
}

export function markDashboardSeen() {
  return apiClient.request("/community/dashboard/seen", { method: "POST", auth: true });
}

export async function fetchDiscover(type: DiscoverType, q: string, offset = 0) {
  const params = new URLSearchParams({ type, q, offset: String(offset) });
  return apiClient.request<{ items: DiscoverItem[]; nextOffset: number | null }>(`/community/discover?${params}`);
}

export async function searchPeople(q: string) {
  return apiClient.request<{ people: PersonResult[] }>(`/community/people?q=${encodeURIComponent(q)}`, { auth: true });
}

export async function fetchProfile(username: string) {
  return apiClient.request<CommunityProfileView>(`/community/profiles/${encodeURIComponent(username)}`, { auth: true });
}

export async function fetchActivity(username: string, cursor?: string): Promise<Page<ActivityItem>> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return apiClient.request<Page<ActivityItem>>(`/community/profiles/${encodeURIComponent(username)}/activity${query}`);
}

export async function fetchProfileLibrary(username: string) {
  return apiClient.request<{ data: LibraryData | null }>(`/community/profiles/${encodeURIComponent(username)}/library`);
}

export function updateFeedSettings(settings: FeedSettings) {
  return apiClient.request("/community/profile/feed-settings", { method: "PUT", body: settings, auth: true });
}

export function followUser(userId: string) {
  return apiClient.request("/community/follows", { method: "POST", body: { userId }, auth: true });
}

export function unfollowUser(userId: string) {
  return apiClient.request(`/community/follows/${userId}`, { method: "DELETE", auth: true });
}

export function publishProfile(muralId: string) {
  return apiClient.request("/community/profile/publish", { method: "PUT", body: { muralId }, auth: true });
}

export function unpublishProfile() {
  return apiClient.request("/community/profile/publish", { method: "DELETE", auth: true });
}
