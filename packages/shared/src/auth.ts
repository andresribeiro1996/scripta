import type { Locale } from "./i18n/locale.js";
import { sharedT } from "./i18n/sharedT.js";

export const passwordHint = (locale: Locale): string => sharedT(locale)("shared.auth.passwordHint");
export const usernameHint = (locale: Locale): string => sharedT(locale)("shared.auth.usernameHint");
export const recoveryMessage = (locale: Locale): string => sharedT(locale)("shared.auth.recoveryMessage");

export function authFieldErrors(mode: "login" | "signup", identifier: string, username: string, password: string, locale: Locale): Record<string, string> {
  const t = sharedT(locale);
  const errors: Record<string, string> = {};
  if (!identifier.trim()) errors.identifier = t(mode === "signup" ? "shared.auth.enterEmail" : "shared.auth.enterEmailOrUsername");
  else if (mode === "signup" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim())) errors.identifier = t("shared.auth.invalidEmail");
  if (mode === "signup" && !/^[a-zA-Z0-9_.]{3,30}$/.test(username.trim())) errors.username = usernameHint(locale);
  if (!password) errors.password = t("shared.auth.enterPassword");
  else if (mode === "signup" && (password.length < 8 || password.length > 128)) errors.password = t("shared.auth.passwordLength");
  return errors;
}

export function safeAuthReturnTo(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return fallback;
  const path = value.split(/[?#]/)[0];
  if (!path || /(?:^|\/)(?:login|oauth-success|choose-username|welcome-avatar|reset-password|forgot-password|verify-email)(?:\/|$)/.test(path)) return fallback;
  return value;
}

export interface AccountSecurity {
  email: string;
  emailVerified: boolean;
  hasPassword: boolean;
  canChangeEmail: boolean;
  emailEnabled: boolean;
}
