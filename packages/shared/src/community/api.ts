import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import { dashboardQuery, isKnownDigestItem, withKnownDigestItems, type DashboardFeedPage, type DigestItem } from "../dashboard.js";
import type { LibraryData } from "../library/index.js";
import { isKnownContent } from "./helpers.js";
import type { ActivityComment, ActivityEngagement, ActivityItem, CommunityProfileView, DiscoverItem, DiscoverType, FeedSettings, OwnProfile, Page, PersonResult, PublishProfileInput, SavedContentRef, SuggestedReader } from "./types.js";

export function createCommunityApi(request: ApiRequest) {
  return {
    fetchActivityEngagement(ids: string[]): Promise<Record<string, ActivityEngagement>> {
      return request("/community/activity/engagement", { method: "POST", body: { ids }, auth: "required" });
    },
    likeActivity(id: string, liked: boolean): Promise<ActivityEngagement> {
      return request(apiPath`/community/activity/${id}/like`, { method: "PUT", body: { liked }, auth: "required" });
    },
    fetchActivityComments(id: string, cursor?: string): Promise<Page<ActivityComment>> {
      return request(apiPath`/community/activity/${id}/comments` + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""), { auth: "required" });
    },
    async addActivityComment(id: string, text: string): Promise<void> {
      await request(apiPath`/community/activity/${id}/comments`, { method: "POST", body: { text }, auth: "required" });
    },
    async deleteActivityComment(id: string): Promise<void> {
      await request(apiPath`/community/activity/comments/${id}`, { method: "DELETE", auth: "required" });
    },
    fetchSavedState(refs: SavedContentRef[]): Promise<string[]> {
      return request("/community/saved/state", { method: "POST", body: { refs }, auth: "required" });
    },
    async saveContent(ref: SavedContentRef, saved: boolean): Promise<void> {
      await request("/community/saved", { method: "PUT", body: { ref, saved }, auth: "required" });
    },
    async fetchSavedContent(cursor?: string): Promise<Page<DigestItem>> {
      const page = await request<Page<DigestItem>>("/community/saved" + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""), { auth: "required" });
      return { ...page, items: page.items.filter(isKnownDigestItem) };
    },
    async fetchDashboard(cursor?: string, kinds?: readonly string[]): Promise<DashboardFeedPage> {
      return withKnownDigestItems(await request<DashboardFeedPage>(`/community/dashboard${dashboardQuery(cursor, kinds)}`, { auth: "required" }));
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
    async fetchSuggestedReaderPortraits(): Promise<SuggestedReader[]> {
      return (await request<{ people: SuggestedReader[] }>("/community/people/suggested?previews=1", { auth: "required" })).people;
    },
    fetchProfile(username: string): Promise<CommunityProfileView> {
      return request<CommunityProfileView>(apiPath`/community/profiles/${username}`, { auth: "optional" });
    },
    fetchActivity(username: string, cursor?: string): Promise<Page<ActivityItem>> {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      return request<Page<ActivityItem>>(apiPath`/community/profiles/${username}/activity` + query, { auth: "optional" });
    },
    fetchProfileLibrary(username: string): Promise<{ data: LibraryData | null }> {
      return request(apiPath`/community/profiles/${username}/library`, { auth: "optional" });
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
