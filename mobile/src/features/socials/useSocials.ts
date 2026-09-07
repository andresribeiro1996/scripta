import { useQuery, useQueryClient } from "@tanstack/react-query";
import { connectBluesky, disconnectSocial, fetchSocials, type SocialProvider, type SocialStatus } from "./api";

export const SOCIALS_QUERY_KEY = ["socials"] as const;

export function useSocials() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: SOCIALS_QUERY_KEY, queryFn: fetchSocials });
  const update = (socials: SocialStatus[]) => queryClient.setQueryData(SOCIALS_QUERY_KEY, socials);
  return {
    ...query,
    async connectBluesky(handle: string, appPassword: string) { update(await connectBluesky(handle, appPassword)); },
    async disconnect(provider: SocialProvider) { update(await disconnectSocial(provider)); },
  };
}
