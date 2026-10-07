import type { Page } from "@scripta/shared/community";
import { createCommunityApi } from "@scripta/shared/community";
import { request } from "../../core/api";

export type { CommunityProfileView } from "@scripta/shared/community";

export type CommunityPage<T> = Page<T>;

export const {
  fetchDashboard,
  markDashboardSeen,
  fetchDiscover,
  searchPeople,
  fetchSuggestedPeople,
  fetchProfile,
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
