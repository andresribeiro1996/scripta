import { useQuery } from "@tanstack/react-query";
import { fetchMyTournaments } from "../api/arena";

export function useMyTournaments() {
  const query = useQuery({ queryKey: ["arenas", "mine"], queryFn: fetchMyTournaments });
  return { tournaments: query.data ?? [], isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}
