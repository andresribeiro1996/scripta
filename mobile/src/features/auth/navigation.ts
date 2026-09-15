import { safeAuthReturnTo } from "@scripta/shared";

let destination = "/";
let avatarPending = false;

export function startAuthNavigation(returnTo: unknown, signup: boolean) {
  destination = safeAuthReturnTo(returnTo, "/");
  avatarPending = signup;
}

export function afterSignIn(username: string | null): string {
  return !username ? "/choose-username" : avatarPending ? "/welcome-avatar" : destination;
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
    if (key === "returnTo" || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
  }
  return safeAuthReturnTo(`${pathname}${query.size ? `?${query}` : ""}`, "/");
}
