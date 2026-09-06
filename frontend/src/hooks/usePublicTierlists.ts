import { useQuery } from "@tanstack/react-query";
import { fetchPublicTierlists } from "../api/tierlistVoting";

export function usePublicTierlists() {
  const query = useQuery({ queryKey: ["tierlists", "public"], queryFn: fetchPublicTierlists });
  return { tierlists: query.data ?? [], isLoading: query.isLoading, error: query.error };
}
