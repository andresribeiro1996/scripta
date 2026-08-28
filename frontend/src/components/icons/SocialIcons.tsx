import type { SocialProvider } from "../../api/socials";

/** Small monochrome glyphs for SocialsSection.tsx's platform rows — one
 *  `currentColor` path per platform (so they pick up the row's own text
 *  color, including the dimmed/disabled state) rather than a brand-color
 *  image asset. These are simplified, hand-drawn approximations of each
 *  platform's mark, not a pixel-exact reproduction of any official
 *  logo file — good enough to identify a row at a glance without
 *  reproducing trademarked artwork verbatim. */
export function SocialIcon({ provider, className }: { provider: SocialProvider; className?: string }) {
  const props = { className, viewBox: "0 0 24 24", xmlns: "http://www.w3.org/2000/svg" };

  switch (provider) {
    case "x":
      return (
        <svg {...props} fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" aria-hidden="true">
          <path d="M5 5l14 14M19 5L5 19" />
        </svg>
      );

    case "instagram":
      return (
        <svg {...props} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none" />
        </svg>
      );

    case "threads":
      return (
        <svg {...props} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12.3 20.5c-4.3 0-7.3-2.7-7.3-8s3-8 7-8c3.5 0 5.9 1.7 6.3 4.6.3 2.1-.7 3.5-2.7 3.9-1.4.3-2.7-.1-3.3-1.2" />
          <circle cx="13.5" cy="12.5" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );

    case "tiktok":
      return (
        <svg {...props} fill="currentColor" stroke="none" aria-hidden="true">
          <path d="M14.5 3.5h-2.3v11.2a2.6 2.6 0 1 1-1.8-2.5v-2.3a4.9 4.9 0 1 0 4.1 4.8V8.9a6.7 6.7 0 0 0 3.9 1.3V7.9c-2-.1-3.7-1.6-3.9-4.4Z" />
        </svg>
      );

    case "bluesky":
      return (
        <svg {...props} fill="currentColor" stroke="none" aria-hidden="true">
          <path d="M12 8.8C10.6 5.9 7.2 3.8 4.3 4.2c-.4 3 1 5.9 3.8 7.3-2.8-.3-4.7 1.1-5.1 3 1.9 1.6 4.8 1.6 6.7-.7.4-.5 1.2-.5 1.6 0 1.9 2.3 4.8 2.3 6.7.7-.4-1.9-2.3-3.3-5.1-3 2.8-1.4 4.2-4.3 3.8-7.3-2.9-.4-6.3 1.7-7.7 4.6Z" />
        </svg>
      );
  }
}
