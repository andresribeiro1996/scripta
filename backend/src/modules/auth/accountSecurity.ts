import * as argon2 from "argon2";
import type { AccountSecurity } from "@scripta/shared";
import type { AuthRepository } from "./domain/ports.js";
import { generateRefreshToken, hashRefreshToken } from "./tokens.js";

export class AccountActionError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function createAccountSecurity(repo: AuthRepository, send: (to: string, subject: string, text: string) => Promise<void>, frontendUrl: string, enabled: boolean) {
  function requireEmail() {
    if (!enabled) throw new AccountActionError("Email delivery is unavailable. Please try again later.", 503);
  }

  async function sendLink(userId: string, email: string, purpose: "reset" | "verify") {
    requireEmail();
    const token = generateRefreshToken();
    const saved = repo.saveAccountToken({ user_id: userId, email, purpose, token_hash: hashRefreshToken(token),
      requested_at: new Date().toISOString(), expires_at: new Date(Date.now() + (purpose === "reset" ? 30 * 60_000 : 24 * 60 * 60_000)).toISOString() });
    if (!saved) return;
    const url = new URL(purpose === "reset" ? "/reset-password" : "/verify-email", frontendUrl);
    url.hash = new URLSearchParams({ token }).toString();
    await send(email, purpose === "reset" ? "Reset your Scripta password" : "Verify your Scripta email",
      `${purpose === "reset" ? "Choose a new password" : "Confirm your email address"}:\n\n${url}\n\nThis link expires in ${purpose === "reset" ? "30 minutes" : "24 hours"} and can be used once. If you didn’t request this, ignore this email.`);
  }

  return {
    enabled,
    status(userId: string): AccountSecurity {
      const user = repo.findUserById(userId);
      if (!user) throw new AccountActionError("Please log in again.", 401);
      return { email: user.email, emailVerified: Boolean(user.email_verified_at), hasPassword: Boolean(user.password_hash), canChangeEmail: Boolean(user.password_hash) && !user.google_id, emailEnabled: enabled };
    },
    async forgotPassword(email: string) {
      requireEmail();
      const user = repo.findUserByEmail(email.trim().toLowerCase());
      if (!user) return;
      if (user.password_hash) await sendLink(user.id, user.email, "reset");
      else {
        const token = generateRefreshToken();
        if (repo.saveAccountToken({ user_id: user.id, email: user.email, purpose: "reset", token_hash: hashRefreshToken(token),
          requested_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30 * 60_000).toISOString() })) {
          await send(user.email, "Sign in to Scripta", `Your account uses Google sign-in. Choose “Sign in with Google” at ${new URL("/login", frontendUrl)}. Your Google password is managed by Google.`);
        }
      }
    },
    async resetPassword(token: string, password: string) {
      const hash = hashRefreshToken(token);
      const row = repo.findAccountToken(hash, "reset");
      if (!row) throw new AccountActionError("This link has expired or was already used. Request a new one.");
      const passwordHash = await argon2.hash(password);
      if (!repo.completePasswordReset(hash, passwordHash)) throw new AccountActionError("This link has expired or was already used. Request a new one.");
      if (enabled) await send(row.email, "Your Scripta password changed", "Your password was reset and all sessions were signed out. If this wasn’t you, reset your password immediately.").catch(() => undefined);
    },
    async changePassword(userId: string, currentPassword: string, password: string) {
      const user = repo.findUserById(userId);
      if (!user?.password_hash || !await argon2.verify(user.password_hash, currentPassword)) throw new AccountActionError("Your current password is incorrect.", 403);
      if (!repo.changePassword(userId, user.password_hash, await argon2.hash(password))) throw new AccountActionError("Your account changed. Please log in again.", 403);
      if (enabled) await send(user.email, "Your Scripta password changed", "Your password was changed and all sessions were signed out. If this wasn’t you, reset your password immediately.").catch(() => undefined);
    },
    async requestVerification(userId: string, email?: string, currentPassword?: string) {
      requireEmail();
      const user = repo.findUserById(userId);
      if (!user) throw new AccountActionError("Please log in again.", 401);
      const target = email?.trim().toLowerCase() ?? user.email;
      if (target !== user.email) {
        if (!user.password_hash || !currentPassword || !await argon2.verify(user.password_hash, currentPassword)) throw new AccountActionError("Enter your current password to change your email.", 403);
        if (repo.findUserById(userId)?.password_hash !== user.password_hash) throw new AccountActionError("Please log in again.", 403);
        if (user.google_id) throw new AccountActionError("Email changes aren’t available for accounts linked to Google.");
        if (repo.findUserByEmail(target)) throw new AccountActionError("That email cannot be used. Try another address.");
      } else if (user.email_verified_at) return;
      await sendLink(user.id, target, "verify");
    },
    verifyEmail(token: string) {
      if (!repo.verifyEmail(hashRefreshToken(token))) throw new AccountActionError("This link has expired, was already used, or the email cannot be used. Request a new one.");
    },
  };
}

export type AccountSecurityService = ReturnType<typeof createAccountSecurity>;
