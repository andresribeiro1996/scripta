import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchHome, initializeHome, selectHome } from "./api";
import type { Mural } from "@scripta/shared";

export function useHome() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["home"], queryFn: fetchHome, refetchOnMount: "always" });
  const mutation = useMutation({
    mutationFn: (choice: string | boolean) => typeof choice === "string" ? selectHome(choice) : initializeHome(choice),
    onSuccess: (mural) => {
      client.setQueryData(["home"], mural);
      client.setQueryData(["murals", mural.id], mural);
      client.setQueryData<Mural[]>(["murals"], (items = []) => [...items.filter((item) => item.id !== mural.id), mural]);
    }
  });
  return { ...query, choose: mutation.mutateAsync, choosing: mutation.isPending, choiceError: mutation.error };
}
