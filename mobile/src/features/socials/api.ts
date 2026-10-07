import { createSocialsApi, type SocialProvider } from "@scripta/shared";
import { Linking, Share } from "react-native";
import { request } from "../../core/api";
import { API_URL } from "../../core/config";

export type { SocialProvider, SocialStatus } from "@scripta/shared";

const socials = createSocialsApi(request);

export const { fetchSocials, connectBluesky, disconnectSocial, postToSocial } = socials;

export async function startSocialConnect(provider: Exclude<SocialProvider, "bluesky">): Promise<void> {
  const linkId = await socials.createLinkSession(provider);
  await Linking.openURL(`${API_URL}/socials/${provider}/connect?linkId=${encodeURIComponent(linkId)}`);
}

export async function shareNatively(message: string, title?: string): Promise<void> {
  await Share.share({ message, title });
}
