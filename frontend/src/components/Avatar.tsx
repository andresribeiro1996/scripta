// The account's avatar, with the agreed fallback: no picture yet (skipped,
// or removed) renders the first letter of the username (or email) on the
// accent color — Linear/Notion-style initial, so the slot never reads as
// missing. Sizing is a plain prop so the same component serves the welcome
// step (large), Settings (medium), and the sidebar (small).

import { API_URL } from "../api/baseUrl";
import type { Session } from "../auth/tokenStore";

/** Plain <img src> target — unauthenticated by design, same UUID trust
 *  model as gallery files (see the backend route's own comment). The id
 *  regenerates on every upload, so the URL itself is the cache-buster. */
export function avatarUrlFor(avatarId: string): string {
  return `${API_URL}/auth/avatar/${avatarId}/file`;
}

export function Avatar({ user, size = 32, className = "" }: { user: Session["user"]; size?: number; className?: string }) {
  if (user.avatarId) {
    return (
      <img
        src={avatarUrlFor(user.avatarId)}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  const initial = (user.username ?? user.email).charAt(0).toUpperCase();
  return (
    <div
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-(--color-accent) font-semibold text-white ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {initial}
    </div>
  );
}
