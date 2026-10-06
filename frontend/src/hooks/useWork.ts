import { useQuery } from "@tanstack/react-query";
import { ApiError } from "../api/client";
import { fetchWork } from "../api/works";

export function useWork(id: string | undefined) {
  const query = useQuery({ queryKey: ["works", id], queryFn: () => fetchWork(id!), enabled: Boolean(id), retry: false });
  return { page: query.data, isLoading: query.isLoading, error: query.error, isNotFound: query.error instanceof ApiError && query.error.status === 404, refetch: query.refetch };
}
