// HTTP layer for the auth module: request validation (zod) and mapping
// service-layer results/errors to responses. No business logic lives
// here — that's all in service.ts. Takes the already-composed AuthService
// as a plain argument (from plugin.ts, the composition root) rather than
// importing service.ts as a module — this file doesn't know or care
// which AuthRepository backs it.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { localeOf, t, validationMessage } from "../../i18n/index.js";
import { authorizationCodeErrorMessage, consumeAuthorizationCode } from "./authorizationCode.js";
import {
  AvatarDimensionsTooLargeError,
  AvatarError,
  AvatarTooLargeError,
  EmailInUseError,
  InvalidAvatarError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  OAuthAccountConflictError,
  UsernameInUseError
} from "./domain/errors.js";
import { recoveryMessage } from "@scripta/shared";
import { LOCALE_PREFERENCES } from "@scripta/shared/i18n";
import { DISPLAY_FONT_PREFERENCES, TEXT_FONT_PREFERENCES, THEME_PREFERENCES } from "@scripta/shared/themes";
import { AccountActionError, type AccountSecurityService } from "./accountSecurity.js";
import type { AuthService } from "./service.js";
import { MAX_AVATAR_UPLOAD_BYTES } from "./service.js";
import { authGuard } from "./guard.js";

const usernameSchema = z
  .string()
  .trim()
  .min(3, "auth.usernameMin")
  .max(30, "auth.usernameMax")
  .regex(/^[a-zA-Z0-9_.]+$/, "auth.usernameChars");

const signupSchema = z.object({
  email: z.string().trim().email("auth.signupInvalidEmail"),
  username: usernameSchema,
  password: z.string().min(8, "auth.passwordMin").max(128, "auth.passwordMax")
});

const loginSchema = z.object({
  identifier: z.string().min(1, "Email or username is required."),
  password: z.string().min(1)
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1)
});

const googleExchangeSchema = z.object({
  code: z.string().min(1),
  // Only required when the code was minted for a flow that sent a PKCE
  // code_challenge when starting /auth/google — see authorizationCode.ts.
  codeVerifier: z.string().min(1).optional()
});

const setUsernameSchema = z.object({
  username: usernameSchema
});

const avatarIdParamSchema = z.object({ id: z.string().uuid() });

const setAppearanceSchema = z
  .object({ theme: z.enum(THEME_PREFERENCES), displayFont: z.enum(DISPLAY_FONT_PREFERENCES), textFont: z.enum(TEXT_FONT_PREFERENCES), locale: z.enum(LOCALE_PREFERENCES) })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0);

function statusForAvatarError(err: AvatarError): number {
  if (err instanceof AvatarTooLargeError) return 413;
  if (err instanceof InvalidAvatarError || err instanceof AvatarDimensionsTooLargeError) return 422;
  return 400;
}

export function buildAuthRoutes(service: AuthService, avatarUrlFor: (id: string) => string, security?: AccountSecurityService) {
  return async function authRoutes(app: FastifyInstance) {
    const deliveries = new Set<Promise<unknown>>();
    function deliver(action: () => Promise<unknown>) {
      const task = Promise.resolve().then(action).catch(() => app.log.error("Account email delivery failed; check email configuration and provider status."));
      deliveries.add(task);
      void task.finally(() => deliveries.delete(task));
    }
    app.addHook("onClose", async () => { await Promise.all(deliveries); });
    app.addHook("onSend", async (_request, reply, payload) => { reply.header("Cache-Control", "no-store"); return payload; });
    if (security) {
      const emailSchema = z.object({ email: z.string().trim().email() });
      const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{64}$/);
      app.get("/auth/account", { preHandler: authGuard }, async (request) => security.status(request.user.id));
      app.post("/auth/forgot-password", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
        const locale = localeOf(request);
        const parsed = emailSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: t(locale, "auth.invalidEmail") });
        if (!security.enabled) return reply.code(503).send({ error: t(locale, "auth.emailUnavailable") });
        deliver(() => security.forgotPassword(parsed.data.email, locale));
        return reply.code(202).send({ message: recoveryMessage(locale) });
      });
      app.post("/auth/reset-password", async (request, reply) => {
        const parsed = z.object({ token: tokenSchema, password: signupSchema.shape.password }).safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: t(localeOf(request), "auth.resetInvalid") });
        await security.resetPassword(parsed.data.token, parsed.data.password, localeOf(request));
        return reply.code(204).send();
      });
      app.post("/auth/change-password", { preHandler: authGuard }, async (request, reply) => {
        const parsed = z.object({ currentPassword: z.string().min(1), password: signupSchema.shape.password }).safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: t(localeOf(request), "auth.changePasswordInvalid") });
        await security.changePassword(request.user.id, parsed.data.currentPassword, parsed.data.password, localeOf(request));
        return reply.code(204).send();
      });
      app.post("/auth/delete-account", { preHandler: authGuard, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
        const parsed = z.object({ password: z.string().max(128).optional(), confirmation: z.string().max(320).optional() }).safeParse(request.body ?? {});
        if (!parsed.success) return reply.code(400).send({ error: t(localeOf(request), "auth.deleteInvalid") });
        await security.deleteAccount(request.user.id, parsed.data.password, parsed.data.confirmation, localeOf(request));
        return reply.code(204).send();
      });
      app.post("/auth/verification-email", { preHandler: authGuard, config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async (request, reply) => {
        const parsed = z.object({ email: z.string().trim().email().optional(), currentPassword: z.string().optional() }).safeParse(request.body ?? {});
        if (!parsed.success) return reply.code(400).send({ error: t(localeOf(request), "auth.invalidEmail") });
        await security.requestVerification(request.user.id, parsed.data.email, parsed.data.currentPassword, localeOf(request));
        return reply.send({ message: t(localeOf(request), "auth.verificationSent") });
      });
      app.post("/auth/verify-email", async (request, reply) => {
        const parsed = z.object({ token: tokenSchema }).safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: t(localeOf(request), "auth.verifyLinkInvalid") });
        security.verifyEmail(parsed.data.token);
        return reply.code(204).send();
      });
    }
    app.post("/auth/signup", async (request, reply) => {
      const locale = localeOf(request);
      const parsed = signupSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: validationMessage(locale, parsed.error) });
      }
      try {
        const { user, tokens } = await service.signup(parsed.data.email, parsed.data.username, parsed.data.password);
        if (security?.enabled) deliver(() => security.requestVerification(user.id, undefined, undefined, locale));
        return reply.code(201).send({ user, ...tokens });
      } catch (err) {
        if (err instanceof EmailInUseError) return reply.code(409).send({ error: t(locale, "auth.emailAlreadyUsed"), field: "identifier" });
        if (err instanceof UsernameInUseError) return reply.code(409).send({ error: t(locale, err.key, err.vars), field: "username" });
        throw err;
      }
    });

    app.post("/auth/login", async (request, reply) => {
      const locale = localeOf(request);
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: t(locale, "auth.loginRequired") });
      }
      try {
        const { user, tokens } = await service.login(parsed.data.identifier, parsed.data.password);
        return reply.send({ user, ...tokens });
      } catch (err) {
        if (err instanceof InvalidCredentialsError) return reply.code(401).send({ error: t(locale, err.key) });
        throw err;
      }
    });

    app.post("/auth/refresh", async (request, reply) => {
      const locale = localeOf(request);
      const parsed = refreshSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: t(locale, "auth.refreshTokenRequired") });
      }
      try {
        const tokens = await service.refresh(parsed.data.refreshToken);
        return reply.send(tokens);
      } catch (err) {
        if (err instanceof InvalidRefreshTokenError) return reply.code(401).send({ error: t(locale, err.key) });
        throw err;
      }
    });

    // Task 4A — exchanges the one-time code /auth/google/callback (plugin.ts)
    // redirects with for the actual session. Registered unconditionally
    // (not gated behind googleOAuthConfigured, unlike the Google routes
    // themselves in plugin.ts): if Google sign-in isn't configured, no
    // code was ever minted, so this just always answers "invalid or
    // expired code" — no need for routes.ts to know about that config
    // flag. Same wire shape as /auth/login and /auth/signup, so a client
    // handles all three identically.
    app.post("/auth/google/exchange", async (request, reply) => {
      const locale = localeOf(request);
      const parsed = googleExchangeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: t(locale, "auth.codeRequired") });
      }
      const result = consumeAuthorizationCode(parsed.data.code, parsed.data.codeVerifier ?? null);
      if (!result.ok) {
        return reply.code(400).send({ error: authorizationCodeErrorMessage(result.reason, locale) });
      }
      return reply.send({ user: result.user, ...result.tokens });
    });

    app.post("/auth/logout", async (request, reply) => {
      const parsed = refreshSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: t(localeOf(request), "auth.refreshTokenRequired") });
      }
      service.logout(parsed.data.refreshToken);
      return reply.code(204).send();
    });

    // Requires a valid access token — logs out every session for that
    // user, not just the one presenting this request ("sign out
    // everywhere").
    app.post("/auth/logout-everywhere", { preHandler: authGuard }, async (request, reply) => {
      service.logoutEverywhere(request.user.id);
      return reply.code(204).send();
    });

    app.get("/auth/me", { preHandler: authGuard }, async (request, reply) => {
      // From the repository, not request.user: the guard's copy comes from
      // JWT claims and can lag a just-completed avatar change (see
      // domain/types.ts's AuthenticatedUser). request.user is the fallback
      // for a user deleted between token issue and this call.
      const user = service.getUserById(request.user.id) ?? request.user;
      return reply.send({ user });
    });

    // Claims a username for the signed-in account — the step a Google
    // sign-in without one yet is routed through on its first login.
    app.post("/auth/username", { preHandler: authGuard }, async (request, reply) => {
      const locale = localeOf(request);
      const parsed = setUsernameSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.issues[0]?.message === undefined ? t(locale, "auth.invalidUsername") : validationMessage(locale, parsed.error) });
      }
      try {
        const user = await service.setUsername(request.user.id, parsed.data.username);
        return reply.send({ user });
      } catch (err) {
        if (err instanceof UsernameInUseError) return reply.code(409).send({ error: t(locale, err.key, err.vars), field: "username" });
        throw err;
      }
    });

    app.get("/auth/appearance", { preHandler: authGuard, config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request) => service.getAppearance(request.user.id));

    app.put("/auth/appearance", { preHandler: authGuard, config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
      const parsed = setAppearanceSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: t(localeOf(request), "auth.unknownAppearance") });
      service.setAppearance(request.user.id, parsed.data);
      return reply.code(204).send();
    });

    app.post(
      "/auth/avatar",
      {
        preHandler: authGuard,
        // Aborts the upload stream over this size rather than buffering it
        // first — belt-and-suspenders alongside service.ts's own cap, same
        // as gallery's upload route.
        bodyLimit: MAX_AVATAR_UPLOAD_BYTES + 1024
      },
      async (request, reply) => {
        const upload = await request.file();
        if (!upload) {
          return reply.code(400).send({ error: t(localeOf(request), "auth.noFile") });
        }
        const buffer = await upload.toBuffer();
        try {
          const user = await service.setAvatar(request.user.id, buffer);
          return reply.send({ user });
        } catch (err) {
          if (err instanceof AvatarError) {
            return reply.code(statusForAvatarError(err)).send({ error: t(localeOf(request), err.key, err.vars) });
          }
          throw err;
        }
      }
    );

    app.delete("/auth/avatar", { preHandler: authGuard }, async (request, reply) => {
      const user = await service.removeAvatar(request.user.id);
      return reply.send({ user });
    });

    // Deliberately NOT behind authGuard — a plain <img src> target, same
    // as gallery's file route. Access control is "the id is an
    // unguessable UUID"; the id regenerates on every replacement, so a
    // cached redirect can't serve a stale avatar after a change.
    app.get("/auth/avatar/:id/file", async (request, reply) => {
      const parsed = avatarIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: t(localeOf(request), "auth.invalidAvatarId") });
      }
      return reply.redirect(avatarUrlFor(parsed.data.id), 301);
    });

    app.setErrorHandler((error, request, reply) => {
      if (error instanceof AccountActionError) return reply.code(error.status).send({ error: t(localeOf(request), error.key, error.vars) });
      if (error instanceof OAuthAccountConflictError) {
        return reply.code(409).send({ error: t(localeOf(request), error.key, error.vars) });
      }
      throw error;
    });
  };
}
