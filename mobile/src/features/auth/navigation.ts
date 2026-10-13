import { safeAuthReturnTo } from "@scripta/shared";

let destination = "/";
let avatarPending = false;

export function startAuthNavigation(returnTo: unknown, signup: boolean) {
  destination = safeAuthReturnTo(returnTo, "/");
  avatarPending = signup;
}

export function afterSignIn(username: string | null): { href: string; withAnchor: boolean } {
  if (!username) return { href: "/choose-username", withAnchor: false };
  if (avatarPending) return { href: "/welcome-avatar", withAnchor: false };
  return { href: destination, withAnchor: true };
}

export function finishAuthNavigation(): string {
  const next = destination;
  destination = "/";
  avatarPending = false;
  return next;
}

export function authDestination(): string { return destination; }

export function pathWithQuery(pathname: string, params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "returnTo" || key === "initial" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
  }
  return safeAuthReturnTo(`${pathname}${query.size ? `?${query}` : ""}`, "/");
}
