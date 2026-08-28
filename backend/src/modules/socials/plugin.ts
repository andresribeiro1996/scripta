// The socials module's Fastify plugin and composition root — mirrors
// modules/auth/plugin.ts's shape, including where the OAuth routes live:
// registered directly here (not routes.ts), one @fastify/oauth2 instance
// per platform, each gated the same "quietly skip if not configured" way
// Google's own OAuth already is.
//
// See linkSessions.ts's own top comment for the full connect-flow design
// (why a linkId exists at all, and how it survives the redirect to/from
// the provider bound to the right user without a session cookie).

import fastifyOauth2 from "@fastify/oauth2";
import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { env, socialsEncryptionConfigured } from "../../config/env.js";
import { openSocialsDb } from "./adapters/sqlite/connection.js";
import { createSqliteSocialsRepository } from "./adapters/sqlite/sqliteSocialsRepository.js";
import { OAUTH_PROVIDERS, type OAuthProviderConfig } from "./providerConfig.js";
import { consumeLinkSession, peekLinkSession } from "./linkSessions.js";
import { buildSocialsRoutes } from "./routes.js";
import { createSocialsService } from "./service.js";

/** noUncheckedIndexedAccess makes a plain `request.query.foo` cast come
 *  back as `string | undefined` even after an `as Record<string, string>`
 *  cast — this centralizes the "read one string query param, default to
 *  empty" narrowing instead of repeating a ternary at each call site. */
function queryParam(request: FastifyRequest, key: string): string {
  const value = (request.query as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" ? value : "";
}

function successRedirectBase(): string {
  return env.SOCIALS_SUCCESS_REDIRECT_URL || `${env.FRONTEND_URL}/dashboard/settings`;
}

/** `provider` here is the internal id ("x", "instagram", …) — always a
 *  fixed, code-controlled string, never interpolated from a request, so
 *  building the redirect URL this way carries no injection risk despite
 *  the string concatenation. */
function redirectWithResult(reply: import("fastify").FastifyReply, provider: string, outcome: "connected" | "error", detail?: string) {
  const url = new URL(successRedirectBase());
  url.searchParams.set("social", provider);
  url.searchParams.set("social_status", outcome);
  if (detail) url.searchParams.set("social_message", detail);
  return reply.redirect(url.toString());
}

async function registerOAuthProvider(app: FastifyInstance, config: OAuthProviderConfig, service: ReturnType<typeof createSocialsService>) {
  if (!config.configured) {
    app.log.warn(`[socials] ${config.displayName} client id/secret/callback URL not set — its connect routes are not registered.`);
    return;
  }

  const oauthInstanceName = `${config.provider}OAuth2`;

  await app.register(fastifyOauth2, {
    name: oauthInstanceName,
    scope: config.scope,
    credentials: {
      client: {
        id: config.clientId,
        secret: config.clientSecret,
        ...(config.clientIdParamName ? { idParamName: config.clientIdParamName } : {})
      },
      auth: config.auth
    },
    pkce: config.pkce,
    startRedirectPath: `/socials/${config.provider}/connect`,
    callbackUri: config.callbackUrl,
    // The whole reason this module needs its own state handling instead
    // of the library's default random one — see linkSessions.ts. The
    // library still independently round-trips whatever this returns
    // through its own signed cookie and checks it back on callback
    // (defaultCheckStateFunction, left untouched below), so CSRF
    // protection is exactly as strong as Google's login flow already
    // gets — this only adds "and it's bound to OUR user", not a
    // replacement for that check.
    generateStateFunction(request: FastifyRequest) {
      const linkId = queryParam(request, "linkId");
      if (!linkId || !peekLinkSession(linkId, config.provider)) {
        throw new Error("This connection link has expired or is invalid — go back to Settings and try connecting again.");
      }
      return linkId;
    }
  });

  const oauthNamespace = (app as unknown as Record<string, { getAccessTokenFromAuthorizationCodeFlow: (request: FastifyRequest) => Promise<{ token: { access_token: string; refresh_token?: string; expires_at?: Date } }> } | undefined>)[
    oauthInstanceName
  ];
  if (!oauthNamespace) {
    throw new Error(`[socials] ${oauthInstanceName} did not register correctly — this is a bug, not a missing env var.`);
  }

  app.get(`/socials/${config.provider}/callback`, async (request, reply) => {
    const state = queryParam(request, "state");
    const userId = consumeLinkSession(state, config.provider);
    if (!userId) {
      return redirectWithResult(reply, config.provider, "error", "This connection link expired — please try again.");
    }

    try {
      const { token } = await oauthNamespace.getAccessTokenFromAuthorizationCodeFlow(request);
      const profile = await config.fetchProfile(token.access_token);

      service.saveConnection({
        userId,
        provider: config.provider,
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? null,
        expiresAt: token.expires_at ? token.expires_at.toISOString() : null,
        accountId: profile.accountId,
        handle: profile.handle
      });
    } catch (err) {
      request.log.error(err, `[socials] ${config.provider} connect failed`);
      return redirectWithResult(reply, config.provider, "error", `Couldn't finish connecting ${config.displayName}.`);
    }

    return redirectWithResult(reply, config.provider, "connected");
  });
}

export async function socialsPlugin(app: FastifyInstance) {
  // --- composition: swap this block to change storage technology ---
  const db = openSocialsDb();
  const socialsRepository = createSqliteSocialsRepository(db);
  const socialsService = createSocialsService(socialsRepository, env.SOCIALS_ENCRYPTION_KEY);
  // -------------------------------------------------------------------

  if (!socialsEncryptionConfigured) {
    app.log.warn("[socials] SOCIALS_ENCRYPTION_KEY not set — connecting any social platform (including Bluesky) will fail with 503.");
  }

  await app.register(fastifyRateLimit, { max: 30, timeWindow: "1 minute" });

  await app.register(buildSocialsRoutes(socialsService));

  for (const config of OAUTH_PROVIDERS) {
    await registerOAuthProvider(app, config, socialsService);
  }
}
