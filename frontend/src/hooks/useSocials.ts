// Shared read/mutate access to the account's connected social platforms —
// same shape as useLibrary.ts, one level simpler since there's no local
// "updater over the current document" pattern to replicate: every mutate
// call here (connectBluesky, disconnectSocial) already returns the whole
// fresh list from the backend, so there's nothing to compute client-side.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { connectBluesky, disconnectSocial, fetchSocials, type SocialStatus } from "../api/socials";

export function useSocials() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["socials"], queryFn: fetchSocials });

  function setSocials(socials: SocialStatus[]) {
    queryClient.setQueryData(["socials"], socials);
  }

  async function connectBlueskyAccount(handle: string, appPassword: string): Promise<void> {
    const socials = await connectBluesky(handle, appPassword);
    setSocials(socials);
  }

  async function disconnect(provider: SocialStatus["provider"]): Promise<void> {
    const socials = await disconnectSocial(provider);
    setSocials(socials);
  }

  return { ...query, connectBlueskyAccount, disconnect };
}
