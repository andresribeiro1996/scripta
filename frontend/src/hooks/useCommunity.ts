import { useQuery } from "@tanstack/react-query";
import type { DiscoverType } from "@scripta/shared/community";
import { ApiError } from "../api/client";
import { fetchCommunityProfile, fetchDiscover, fetchPeople } from "../api/community";

export function useCommunityDiscover(type: DiscoverType, q: string) {
  const query = useQuery({ queryKey: ["community", "discover", type, q], queryFn: () => fetchDiscover(type, q), retry: false });
  return { items: query.data?.items ?? [], isLoading: query.isPending, error: query.error, refetch: query.refetch };
}

export function useCommunityPeople(q: string) {
  const query = useQuery({ queryKey: ["community", "people", q], queryFn: () => fetchPeople(q), enabled: q.trim().length > 0, retry: false });
  return { people: query.data ?? [], isLoading: query.isPending, error: query.error, refetch: query.refetch };
}

export function useCommunityProfile(username: string) {
  const query = useQuery({ queryKey: ["community", "profile", username], queryFn: () => fetchCommunityProfile(username), enabled: Boolean(username), retry: false });
  return {
    view: query.data,
    isLoading: query.isPending,
    error: query.error,
    isNotFound: query.error instanceof ApiError && query.error.status === 404,
    refetch: query.refetch
  };
}
