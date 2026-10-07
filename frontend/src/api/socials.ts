import { createSocialsApi, type SocialProvider } from "@scripta/shared";
import { API_URL } from "./baseUrl";
import { ApiError } from "./client";
import { request } from "./request";

export type { SocialProvider, SocialStatus } from "@scripta/shared";

const socials = createSocialsApi(request);

export const { fetchSocials, connectBluesky, disconnectSocial, postToSocial } = socials;

export async function startSocialConnect(provider: Exclude<SocialProvider, "bluesky">): Promise<void> {
  const linkId = await socials.createLinkSession(provider);
  window.location.href = `${API_URL}/socials/${provider}/connect?linkId=${encodeURIComponent(linkId)}`;
}

export { ApiError };
