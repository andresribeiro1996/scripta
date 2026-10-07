import { createCommunityApi } from "@scripta/shared/community";
import { request } from "./request";

export type { CommunityProfileView } from "@scripta/shared/community";

export const {
  fetchDashboard,
  markDashboardSeen,
  fetchDiscover,
  searchPeople: fetchPeople,
  fetchSuggestedPeople,
  fetchProfile: fetchCommunityProfile,
  fetchActivity,
  fetchProfileLibrary,
  updateFeedSettings,
  followUser,
  unfollowUser,
  publishProfile,
  unpublishProfile,
  fetchOwnProfile,
  setShelfMural,
} = createCommunityApi(request);
