import { safeAuthReturnTo } from "@scripta/shared";

export function saveAuthReturnTo(value: unknown): void {
  sessionStorage.setItem("scripta_auth_return_to", safeAuthReturnTo(value, "/dashboard"));
}

export function getAuthReturnTo(): string {
  return safeAuthReturnTo(sessionStorage.getItem("scripta_auth_return_to"), "/dashboard");
}

export function takeAuthReturnTo(): string {
  const value = getAuthReturnTo();
  sessionStorage.removeItem("scripta_auth_return_to");
  sessionStorage.removeItem("scripta_auth_avatar");
  return value;
}

export function startAuthNavigation(value: unknown, signup: boolean): void {
  saveAuthReturnTo(value);
  sessionStorage.setItem("scripta_auth_avatar", String(signup));
}

export function afterSignIn(username: string | null): string {
  return !username ? "/choose-username" : sessionStorage.getItem("scripta_auth_avatar") === "true" ? "/welcome-avatar" : getAuthReturnTo();
}
