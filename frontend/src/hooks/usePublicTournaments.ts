import { useQuery } from "@tanstack/react-query";
import { fetchPublicTournaments } from "../api/arena";

export function usePublicTournaments() {
  const query = useQuery({ queryKey: ["arenas", "public"], queryFn: fetchPublicTournaments });
  return { tournaments: query.data ?? [], isLoading: query.isLoading, error: query.error };
}
