import type { SocialProvider } from "./api";

export const PROVIDER_MARKS: Record<SocialProvider, { glyph: string; color?: string }> = {
  x: { glyph: "x-twitter" },
  instagram: { glyph: "instagram", color: "#E4405F" },
  threads: { glyph: "threads" },
  tiktok: { glyph: "tiktok" },
  bluesky: { glyph: "bluesky", color: "#1185FE" },
};
