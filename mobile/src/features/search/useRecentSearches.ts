import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../core/auth";
import { readRecentSearches, recentSearchesKey, recordRecentSearch } from "./searchModel";

export function useRecentSearches() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["search", "recent", user?.id ?? ""];
  const key = recentSearchesKey(user?.id ?? "");
  const recent = useQuery({ queryKey, queryFn: async () => readRecentSearches(await AsyncStorage.getItem(key)), enabled: !!user, retry: false });

  function save(next: string[]) {
    queryClient.setQueryData(queryKey, next);
    AsyncStorage.setItem(key, JSON.stringify(next)).catch((err: unknown) => {
      console.warn("Couldn't save recent searches on this device.", err);
    });
  }

  return {
    searches: recent.data ?? [],
    record: (query: string) => save(recordRecentSearch(queryClient.getQueryData<string[]>(queryKey) ?? [], query)),
    clear: () => save([]),
  };
}
