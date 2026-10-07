import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import { dashboardQuery, withKnownDigestItems, type DashboardFeedPage } from "../dashboard.js";
import type { LibraryData } from "../library/index.js";
import { isKnownContent } from "./helpers.js";
import type { ActivityItem, CommunityProfileView, DiscoverItem, DiscoverType, FeedSettings, OwnProfile, Page, PersonResult, PublishProfileInput, SuggestedReader } from "./types.js";

export function createCommunityApi(request: ApiRequest) {
  return {
    async fetchDashboard(cursor?: string): Promise<DashboardFeedPage> {
      return withKnownDigestItems(await request<DashboardFeedPage>(`/community/dashboard${dashboardQuery(cursor)}`, { auth: "required" }));
    },
    async markDashboardSeen(): Promise<void> {
      await request("/community/dashboard/seen", { method: "POST", auth: "required" });
    },
    async fetchDiscover(type: DiscoverType, q: string, offset = 0): Promise<{ items: DiscoverItem[]; nextOffset: number | null }> {
      const params = new URLSearchParams({ type, q, offset: String(offset) });
      const page = await request<{ items: DiscoverItem[]; nextOffset: number | null }>(`/community/discover?${params}`, { auth: "optional" });
      return { ...page, items: page.items.filter((item) => isKnownContent(item.content)) };
    },
    async searchPeople(q: string): Promise<PersonResult[]> {
      return (await request<{ people: PersonResult[] }>(`/community/people?q=${encodeURIComponent(q)}`, { auth: "required" })).people;
    },
    async fetchSuggestedPeople(): Promise<SuggestedReader[]> {
      return (await request<{ people: SuggestedReader[] }>("/community/people/suggested", { auth: "required" })).people;
    },
    fetchProfile(username: string): Promise<CommunityProfileView> {
      return request<CommunityProfileView>(apiPath`/community/profiles/${username}`, { auth: "optional" });
    },
    fetchActivity(username: string, cursor?: string): Promise<Page<ActivityItem>> {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      return request<Page<ActivityItem>>(apiPath`/community/profiles/${username}/activity` + query, { auth: "optional" });
    },
    fetchProfileLibrary(username: string): Promise<{ data: LibraryData | null }> {
      return request(apiPath`/community/profiles/${username}/library`, { auth: "none" });
    },
    async updateFeedSettings(settings: FeedSettings): Promise<void> {
      await request("/community/profile/feed-settings", { method: "PUT", body: settings, auth: "required" });
    },
    async followUser(userId: string): Promise<void> {
      await request("/community/follows", { method: "POST", body: { userId }, auth: "required" });
    },
    async unfollowUser(userId: string): Promise<void> {
      await request(apiPath`/community/follows/${userId}`, { method: "DELETE", auth: "required" });
    },
    async publishProfile(input: PublishProfileInput): Promise<void> {
      await request("/community/profile/publish", { method: "PUT", body: input, auth: "required" });
    },
    async unpublishProfile(): Promise<void> {
      await request("/community/profile/publish", { method: "DELETE", auth: "required" });
    },
    fetchOwnProfile(): Promise<OwnProfile> {
      return request<OwnProfile>("/community/profile", { auth: "required" });
    },
    async setShelfMural(muralId: string): Promise<void> {
      await request("/community/profile/mural", { method: "PUT", body: { muralId }, auth: "required" });
    },
  };
}

export type CommunityApi = ReturnType<typeof createCommunityApi>;
