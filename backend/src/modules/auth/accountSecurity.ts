import * as argon2 from "argon2";
import type { AccountSecurity } from "@scripta/shared";
import type { Locale } from "@scripta/shared/i18n";
import { LocalizedError, t, type BackendKey } from "../../i18n/index.js";
import type { AuthRepository } from "./domain/ports.js";
import { renderEmail, type EmailContent } from "./emailLayout.js";
import { generateRefreshToken, hashRefreshToken } from "./tokens.js";

export class AccountActionError extends LocalizedError {
  constructor(key: BackendKey, readonly status = 400) { super(key); }
}

export function createAccountSecurity(repo: AuthRepository, send: (to: string, subject: string, text: string, html?: string) => Promise<void>, frontendUrl: string, enabled: boolean, eraseUserData: (userId: string) => Promise<void>) {
  async function notify(to: string, subject: string, content: EmailContent, locale: Locale) {
    const mail = renderEmail(content, frontendUrl, locale);
    await send(to, subject, mail.text, mail.html);
  }

  function requireEmail() {
    if (!enabled) throw new AccountActionError("auth.emailUnavailable", 503);
  }

  async function sendLink(userId: string, email: string, purpose: "reset" | "verify", locale: Locale) {
    requireEmail();
    const token = generateRefreshToken();
    const saved = repo.saveAccountToken({ user_id: userId, email, purpose, token_hash: hashRefreshToken(token),
      requested_at: new Date().toISOString(), expires_at: new Date(Date.now() + (purpose === "reset" ? 30 * 60_000 : 24 * 60 * 60_000)).toISOString() });
    if (!saved) return;
    const url = new URL(purpose === "reset" ? "/reset-password" : "/verify-email", frontendUrl);
    url.hash = new URLSearchParams({ token }).toString();
    const text = (part: "Subject" | "Heading" | "Body" | "Button" | "Footnote") => t(locale, `email.${purpose}${part}`);
    await notify(email, text("Subject"), { heading: text("Heading"), paragraphs: [text("Body")], button: { label: text("Button"), url: url.toString() }, footnote: text("Footnote") }, locale);
  }
  return {
    enabled,
    status(userId: string): AccountSecurity {
      const user = repo.findUserById(userId);
      if (!user) throw new AccountActionError("auth.loginAgain", 401);
      return { email: user.email, emailVerified: Boolean(user.email_verified_at), hasPassword: Boolean(user.password_hash), canChangeEmail: Boolean(user.password_hash) && !user.google_id, emailEnabled: enabled };
    },
    async forgotPassword(email: string, locale: Locale) {
      requireEmail();
      const user = repo.findUserByEmail(email.trim().toLowerCase());
      if (!user) return;
      if (user.password_hash) await sendLink(user.id, user.email, "reset", locale);
      else {
        const token = generateRefreshToken();
        if (repo.saveAccountToken({ user_id: user.id, email: user.email, purpose: "reset", token_hash: hashRefreshToken(token),
          requested_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30 * 60_000).toISOString() })) {
          await notify(user.email, t(locale, "email.googleSubject"), {
            heading: t(locale, "email.googleHeading"),
            paragraphs: [t(locale, "email.googleBody"), t(locale, "email.googlePassword")],
            button: { label: t(locale, "email.googleButton"), url: new URL("/login", frontendUrl).toString() }
          }, locale);
        }
      }
    },
    async resetPassword(token: string, password: string, locale: Locale) {
      const hash = hashRefreshToken(token);
      const row = repo.findAccountToken(hash, "reset");
      if (!row) throw new AccountActionError("auth.resetLinkExpired");
      const passwordHash = await argon2.hash(password);
      if (!repo.completePasswordReset(hash, passwordHash)) throw new AccountActionError("auth.resetLinkExpired");
      if (enabled) await notify(row.email, t(locale, "email.passwordChangedSubject"), { heading: t(locale, "email.passwordResetHeading"), paragraphs: [t(locale, "email.passwordResetBody")], footnote: t(locale, "email.passwordChangedFootnote") }, locale).catch(() => undefined);
    },
    async changePassword(userId: string, currentPassword: string, password: string, locale: Locale) {
      const user = repo.findUserById(userId);
      if (!user?.password_hash || !await argon2.verify(user.password_hash, currentPassword)) throw new AccountActionError("auth.currentPasswordIncorrect", 403);
      if (!repo.changePassword(userId, user.password_hash, await argon2.hash(password))) throw new AccountActionError("auth.accountChanged", 403);
      if (enabled) await notify(user.email, t(locale, "email.passwordChangedSubject"), { heading: t(locale, "email.passwordChangedHeading"), paragraphs: [t(locale, "email.passwordChangedBody")], footnote: t(locale, "email.passwordChangedFootnote") }, locale).catch(() => undefined);
    },
    async requestVerification(userId: string, email: string | undefined, currentPassword: string | undefined, locale: Locale) {
      requireEmail();
      const user = repo.findUserById(userId);
      if (!user) throw new AccountActionError("auth.loginAgain", 401);
      const target = email?.trim().toLowerCase() ?? user.email;
      if (target !== user.email) {
        if (!user.password_hash || !currentPassword || !await argon2.verify(user.password_hash, currentPassword)) throw new AccountActionError("auth.currentPasswordRequired", 403);
        if (repo.findUserById(userId)?.password_hash !== user.password_hash) throw new AccountActionError("auth.loginAgain", 403);
        if (user.google_id) throw new AccountActionError("auth.googleEmailChange");
        if (repo.findUserByEmail(target)) throw new AccountActionError("auth.emailCannotBeUsed");
      } else if (user.email_verified_at) return;
      await sendLink(user.id, target, "verify", locale);
    },
    async deleteAccount(userId: string, password: string | undefined, confirmation: string | undefined, locale: Locale) {
      const user = repo.findUserById(userId);
      if (!user) throw new AccountActionError("auth.loginAgain", 401);
      if (user.password_hash) {
        if (!password || !await argon2.verify(user.password_hash, password)) throw new AccountActionError("auth.passwordIncorrect", 403);
      } else if (confirmation?.trim().toLowerCase() !== (user.username ?? user.email).toLowerCase()) {
        throw new AccountActionError(user.username ? "auth.confirmUsername" : "auth.confirmEmail", 403);
      }
      repo.revokeSessions(userId);
      await eraseUserData(userId);
      repo.deleteUser(userId);
      if (enabled) await notify(user.email, t(locale, "email.deletedSubject"), { heading: t(locale, "email.deletedHeading"), paragraphs: [t(locale, "email.deletedBody"), t(locale, "email.deletedUndone")] }, locale).catch(() => undefined);
    },
    verifyEmail(token: string) {
      if (!repo.verifyEmail(hashRefreshToken(token))) throw new AccountActionError("auth.verifyLinkExpired");
    },
  };
}

export type AccountSecurityService = ReturnType<typeof createAccountSecurity>;
