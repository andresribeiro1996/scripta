import type { Session } from "../auth/tokenStore";

export type AuthMode = "login" | "signup";

export function landingDestination(session: Session | null): string | null {
  return session ? "/dashboard" : null;
}

export function discoverDestination(session: Session | null): string | null {
  return session ? "/community/discover" : null;
}

export function modeFromSearch(params: URLSearchParams): AuthMode {
  return params.get("mode") === "signup" ? "signup" : "login";
}
