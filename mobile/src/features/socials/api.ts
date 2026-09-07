import { Linking, Share } from "react-native";
import { apiClient } from "../../core/api";
import { API_URL } from "../../core/config";

export type SocialProvider = "x" | "instagram" | "threads" | "tiktok" | "bluesky";

export interface SocialStatus {
  provider: SocialProvider;
  enabled: boolean;
  connected: boolean;
  handle: string | null;
  connectedAt: string | null;
}

export async function fetchSocials(): Promise<SocialStatus[]> {
  return (await apiClient.request<{ socials: SocialStatus[] }>("/socials", { auth: true })).socials;
}

export async function startSocialConnect(provider: Exclude<SocialProvider, "bluesky">): Promise<void> {
  const { linkId } = await apiClient.request<{ linkId: string }>(`/socials/${provider}/link-session`, { method: "POST", auth: true });
  await Linking.openURL(`${API_URL}/socials/${provider}/connect?linkId=${encodeURIComponent(linkId)}`);
}

export async function connectBluesky(handle: string, appPassword: string): Promise<SocialStatus[]> {
  return (await apiClient.request<{ socials: SocialStatus[] }>("/socials/bluesky/connect", { method: "POST", body: { handle, appPassword }, auth: true })).socials;
}

export async function disconnectSocial(provider: SocialProvider): Promise<SocialStatus[]> {
  return (await apiClient.request<{ socials: SocialStatus[] }>(`/socials/${provider}`, { method: "DELETE", auth: true })).socials;
}

export async function postToSocial(provider: "x" | "threads", text: string): Promise<{ postUrl?: string }> {
  return apiClient.request(`/socials/${provider}/post`, { method: "POST", body: { text }, auth: true });
}

export async function shareNatively(message: string, title?: string): Promise<void> {
  await Share.share({ message, title });
}
