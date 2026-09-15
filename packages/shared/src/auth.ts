export const PASSWORD_HINT = "Use at least 8 characters. A longer passphrase is better.";
export const USERNAME_HINT = "3–30 characters: letters, numbers, periods, or underscores.";
export const RECOVERY_MESSAGE = "If an account uses this email, we’ll send instructions. Check your inbox and spam folder.";

export function authFieldErrors(mode: "login" | "signup", identifier: string, username: string, password: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!identifier.trim()) errors.identifier = mode === "signup" ? "Enter your email." : "Enter your email or username.";
  else if (mode === "signup" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim())) errors.identifier = "Enter a valid email address.";
  if (mode === "signup" && !/^[a-zA-Z0-9_.]{3,30}$/.test(username.trim())) errors.username = USERNAME_HINT;
  if (!password) errors.password = "Enter your password.";
  else if (mode === "signup" && (password.length < 8 || password.length > 128)) errors.password = "Use between 8 and 128 characters.";
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
