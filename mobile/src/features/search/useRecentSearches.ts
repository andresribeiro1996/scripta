import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../core/auth";
import { readRecentSearches, recentSearchesKey, recordRecentSearch } from "./searchModel";

export function useRecentSearches() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ["search", "recent", user?.id ?? ""];
  const key = recentSearchesKey(user?.id ?? "");
  const load = async () => readRecentSearches(await AsyncStorage.getItem(key));
  const recent = useQuery({ queryKey, queryFn: load, enabled: !!user, retry: false });

  function save(next: string[]) {
    queryClient.setQueryData(queryKey, next);
    AsyncStorage.setItem(key, JSON.stringify(next)).catch((err: unknown) => {
      console.warn("Couldn't save recent searches on this device.", err);
    });
  }

  return {
    searches: recent.data ?? [],
    record: (query: string) => {
      if (!user) return;
      queryClient.ensureQueryData({ queryKey, queryFn: load }).then(
        (list) => save(recordRecentSearch(queryClient.getQueryData<string[]>(queryKey) ?? list, query)),
        (err: unknown) => console.warn("Couldn't read recent searches on this device.", err),
      );
    },
    clear: () => save([]),
  };
}
