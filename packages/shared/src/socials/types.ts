export type SocialProvider = "x" | "instagram" | "threads" | "tiktok" | "bluesky";

export interface SocialStatus {
  provider: SocialProvider;
  enabled: boolean;
  connected: boolean;
  handle: string | null;
  connectedAt: string | null;
}
