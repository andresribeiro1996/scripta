// The auth module's Fastify plugin — the single entry point other code
// registers to mount this module. Everything registered inside this
// function (routes, oauth2, rate-limit) is encapsulated to this plugin's
// context by Fastify's plugin system: nothing here is reachable from
// outside unless explicitly re-exported through index.ts.
//
// This is also the module's composition root — the one place that knows
// the concrete adapter (SQLite) actually backing the AuthRepository port,
// and wires it into the service. Nothing above this file (routes.ts,
// service.ts, domain/) knows or cares that it's SQLite.

import fastifyMultipart from "@fastify/multipart";
import fastifyOauth2 from "@fastify/oauth2";
import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env, googleOAuthConfigured } from "../../config/env.js";
import { createFsAvatarBlobStore } from "./adapters/fs/avatarBlobStore.js";
import { createSqliteAuthRepository } from "./adapters/sqlite/sqliteAuthRepository.js";
import { openAuthDb } from "./adapters/sqlite/connection.js";
import { createAuthorizationCode } from "./authorizationCode.js";
import { consumeGoogleOAuthFlow, createGoogleOAuthFlow } from "./googleOAuthFlow.js";
import { isValidGoogleOAuthState } from "./googleOAuthState.js";
import { validateGoogleStartRequest } from "./googleStartRequest.js";
import { parseMobileRedirectAllowlist } from "./mobileRedirectAllowlist.js";
import { buildAuthRoutes } from "./routes.js";
import { createAuthService, MAX_AVATAR_UPLOAD_BYTES } from "./service.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const consoleHtml = readFileSync(`${moduleDir}/public/console.html`, "utf8");

// @fastify/oauth2 ships a GOOGLE_CONFIGURATION constant with these same
// values, but its `export =` type declaration doesn't carry the static
// provider-config properties through the default import (an upstream
// typing gap, not a design choice here) — so these well-known, stable
// Google OAuth2 endpoints are just inlined instead.
const GOOGLE_OAUTH_ENDPOINTS = {
  authorizeHost: "https://accounts.google.com",
  authorizePath: "/o/oauth2/v2/auth",
  tokenHost: "https://www.googleapis.com",
  tokenPath: "/oauth2/v4/token"
};

// __Host- cookies require HTTPS. GOOGLE_CALLBACK_URL is the browser-facing
// deployment URL, so TLS-terminated production uses the hardened name while
// plain-http LAN development keeps working with the library default.
const OAUTH_HOST_PREFIXED_COOKIES = env.GOOGLE_CALLBACK_URL.startsWith("https://");
const OAUTH_REDIRECT_STATE_COOKIE_NAME = OAUTH_HOST_PREFIXED_COOKIES
  ? "__Host-oauth2-redirect-state"
  : "oauth2-redirect-state";
const OAUTH_COOKIE_OPTIONS: { signed?: boolean } = { signed: false };

/** noUncheckedIndexedAccess makes a plain `request.query.foo` cast come
 *  back as `string | undefined` even after an `as Record<string, string>`
 *  cast — same helper as modules/socials/plugin.ts's own queryParam,
 *  duplicated rather than shared since these are two independently
 *  swappable modules (see backend/README's module-isolation convention). */
function queryParam(request: FastifyRequest, key: string): string {
  const value = (request.query as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" ? value : "";
}

export async function authPlugin(app: FastifyInstance) {
  // --- composition: swap this one block to change storage technology ---
  const db = openAuthDb();
  const authRepository = createSqliteAuthRepository(db);
  const avatarStore = createFsAvatarBlobStore(env.AVATAR_STORAGE_PATH);
  const authService = createAuthService(authRepository, avatarStore);
  // -----------------------------------------------------------------------

  // Scoped to this plugin only — login/signup/refresh are the endpoints
  // worth protecting from brute-forcing; the rest of the app (once it
  // exists) sets its own rate limits independently, if any.
  await app.register(fastifyRateLimit, {
    max: 20,
    timeWindow: "1 minute"
  });

  // Also plugin-scoped: only the avatar upload route needs multipart
  // parsing (same pattern as gallery's own registration there).
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: MAX_AVATAR_UPLOAD_BYTES,
      files: 1
    }
  });

  await app.register(buildAuthRoutes(authService));

  // A minimal, self-contained HTML test console for this module — not a
  // real app screen. Lets you exercise signup/login/refresh/logout/Google
  // from a browser instead of curl. See public/console.html.
  app.get("/auth/console", async (_request, reply) => {
    reply.type("text/html").send(consoleHtml);
  });

  app.get("/auth/providers", async (_request, reply) => {
    reply.send({ google: googleOAuthConfigured });
  });

  if (googleOAuthConfigured) {
    const mobileRedirectAllowlist = parseMobileRedirectAllowlist(env.MOBILE_OAUTH_REDIRECT_ALLOWLIST);

    await app.register(fastifyOauth2, {
      name: "googleOAuth2",
      scope: ["email", "profile"],
      credentials: {
        client: { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET },
        auth: GOOGLE_OAUTH_ENDPOINTS
      },
      startRedirectPath: "/auth/google",
      callbackUri: env.GOOGLE_CALLBACK_URL,
      cookie: OAUTH_COOKIE_OPTIONS,
      hostPrefixedCookies: OAUTH_HOST_PREFIXED_COOKIES,
      // Threads this flow's PKCE code_challenge, (for a mobile caller)
      // chosen redirect target, and mobile client-side state nonce through
      // Google's own round trip — see googleOAuthFlow.ts's top comment.
      // Validation (PKCE-required-for-redirect_target included — BLOCKER
      // 2(a)) is pulled out into googleStartRequest.ts so it's
      // unit-testable without Fastify. Throwing here (same as
      // modules/socials/plugin.ts's own generateStateFunction) makes
      // @fastify/oauth2 reply 500 with the message instead of starting a
      // flow bound to a request parameter this backend never validated.
      generateStateFunction(request: FastifyRequest) {
        const codeChallengeParam = queryParam(request, "code_challenge") || null;
        const codeChallengeMethodParam = queryParam(request, "code_challenge_method") || null;
        const redirectTargetParam = queryParam(request, "redirect_target") || null;
        const clientState = queryParam(request, "client_state") || null;

        const { codeChallenge, redirectTarget } = validateGoogleStartRequest(
          { codeChallenge: codeChallengeParam, codeChallengeMethod: codeChallengeMethodParam, redirectTargetParam },
          mobileRedirectAllowlist
        );

        return createGoogleOAuthFlow({ codeChallenge, redirectTarget, clientState });
      },
      // BLOCKER 1 — @fastify/oauth2 v8 rejects registration outright if
      // generateStateFunction is given without a checkStateFunction (its
      // `!a ^ !b` guard in index.js); supplying generateStateFunction above
      // without this meant the backend never booted with Google configured.
      // This is the actual CSRF check (equivalent to the library's own
      // unexported defaultCheckStateFunction): the callback's `state` query
      // param must equal the redirect-state cookie the SAME start request
      // set. A single-arg, boolean-returning function (rather than the
      // (request, callback) form) — @fastify/oauth2 promisifies this itself
      // (checkStateFunctionCallbacked's `.length <= 1` branch). NEVER
      // replace this with `checkStateFunction: () => true` — that satisfies
      // the registration guard but throws away the whole protection this
      // option exists to provide. See googleOAuthState.ts for the pure
      // comparison this wraps.
      checkStateFunction(request: FastifyRequest): boolean {
        const state = queryParam(request, "state") || undefined;
        const rawCookie = request.cookies[OAUTH_REDIRECT_STATE_COOKIE_NAME];
        const stateCookie = !OAUTH_COOKIE_OPTIONS.signed
          ? rawCookie
          : (() => {
              if (rawCookie === undefined || typeof request.unsignCookie !== "function") return undefined;
              const unsigned = request.unsignCookie(rawCookie);
              return unsigned.valid ? unsigned.value : undefined;
            })();

        return isValidGoogleOAuthState(state, stateCookie);
      }
    });

    app.get("/auth/google/callback", async (request, reply) => {
      const { token } = await app.googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(request, reply);
      const flow = consumeGoogleOAuthFlow(queryParam(request, "state"));
      if (!flow) {
        return reply.code(400).send({ error: "Google OAuth flow is missing, expired, or already used." });
      }

      const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${token.access_token}` }
      });
      if (!profileResponse.ok) {
        return reply.code(502).send({ error: "Could not fetch Google profile." });
      }
      const profile = (await profileResponse.json()) as { id: string; email?: string };
      if (!profile.email) {
        return reply.code(400).send({ error: "Google account has no email to sign in with." });
      }

      const { user, tokens } = await authService.loginWithGoogle({ googleId: profile.id, email: profile.email });

      // Never place access or refresh tokens in URLs (global constraint):
      // the tokens are already minted above, but they stay server-side —
      // only this short-lived, single-use, PKCE-bound code rides the
      // redirect. See authorizationCode.ts.
      const code = createAuthorizationCode({ user, tokens, codeChallenge: flow.codeChallenge });

      const redirectBase = flow.redirectTarget ?? env.OAUTH_SUCCESS_REDIRECT_URL;
      const redirectUrl = new URL(redirectBase);
      redirectUrl.searchParams.set("code", code);
      // BLOCKER 2(b) — echo the mobile app's own client_state nonce back
      // verbatim (see googleOAuthFlow.ts's own comment on clientState);
      // googleSignIn.ts refuses to accept `code` unless this matches the
      // nonce it generated before opening this flow. Absent for a flow
      // that sent none (the plain desktop-web flow).
      if (flow.clientState) {
        redirectUrl.searchParams.set("state", flow.clientState);
      }
      return reply.redirect(redirectUrl.toString());
    });
  } else {
    app.log.warn("[auth] GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL not set — Google sign-in routes are not registered.");
  }
}

declare module "fastify" {
  interface FastifyInstance {
    googleOAuth2: import("@fastify/oauth2").OAuth2Namespace;
  }
}
