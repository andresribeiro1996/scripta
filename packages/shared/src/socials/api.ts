import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import type { SocialProvider, SocialStatus } from "./types.js";

export function createSocialsApi(request: ApiRequest) {
  return {
    async fetchSocials(): Promise<SocialStatus[]> {
      return (await request<{ socials: SocialStatus[] }>("/socials", { auth: "required" })).socials;
    },
    async createLinkSession(provider: Exclude<SocialProvider, "bluesky">): Promise<string> {
      return (await request<{ linkId: string }>(apiPath`/socials/${provider}/link-session`, { method: "POST", auth: "required" })).linkId;
    },
    async connectBluesky(handle: string, appPassword: string): Promise<SocialStatus[]> {
      return (await request<{ socials: SocialStatus[] }>("/socials/bluesky/connect", { method: "POST", body: { handle, appPassword }, auth: "required" })).socials;
    },
    async disconnectSocial(provider: SocialProvider): Promise<SocialStatus[]> {
      return (await request<{ socials: SocialStatus[] }>(apiPath`/socials/${provider}`, { method: "DELETE", auth: "required" })).socials;
    },
    postToSocial(provider: "x" | "threads", text: string): Promise<{ postUrl?: string }> {
      return request(apiPath`/socials/${provider}/post`, { method: "POST", body: { text }, auth: "required" });
    },
  };
}

export type SocialsApi = ReturnType<typeof createSocialsApi>;
