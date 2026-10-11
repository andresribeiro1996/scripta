import { useQuery } from "@tanstack/react-query";
import { fetchWorkStats } from "../api/works";

export function useWorkStats(id: string | undefined) {
  return useQuery({ queryKey: ["works", id, "stats"], queryFn: () => fetchWorkStats(id!), enabled: Boolean(id), retry: false });
}
