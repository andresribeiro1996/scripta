import { useQuery } from "@tanstack/react-query";
import { fetchVotedTierlists } from "../api/tierlistVoting";

export function useVotedTierlists() {
  const query = useQuery({ queryKey: ["tierlists", "voted"], queryFn: fetchVotedTierlists });
  return { tierlists: query.data ?? [], isLoading: query.isLoading, error: query.error };
}
