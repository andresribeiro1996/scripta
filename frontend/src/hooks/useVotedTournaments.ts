import { useQuery } from "@tanstack/react-query";
import { fetchVotedTournaments } from "../api/arena";

export function useVotedTournaments() {
  const query = useQuery({ queryKey: ["arenas", "voted"], queryFn: fetchVotedTournaments });
  return { tournaments: query.data ?? [], isLoading: query.isLoading, error: query.error };
}
