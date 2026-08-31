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

import fastifyOauth2 from "@fastify/oauth2";
import fastifyRateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env, googleOAuthConfigured, isProduction } from "../../config/env.js";
import { createSqliteAuthRepository } from "./adapters/sqlite/sqliteAuthRepository.js";
import { openAuthDb } from "./adapters/sqlite/connection.js";
import { buildAuthRoutes } from "./routes.js";
import { createAuthService } from "./service.js";

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

export async function authPlugin(app: FastifyInstance) {
  // --- composition: swap this one block to change storage technology ---
  const db = openAuthDb();
  const authRepository = createSqliteAuthRepository(db);
  const authService = createAuthService(authRepository);
  // -----------------------------------------------------------------------

  // Scoped to this plugin only — login/signup/refresh are the endpoints
  // worth protecting from brute-forcing; the rest of the app (once it
  // exists) sets its own rate limits independently, if any.
  await app.register(fastifyRateLimit, {
    max: 20,
    timeWindow: "1 minute"
  });

  await app.register(buildAuthRoutes(authService));

  // A minimal, self-contained HTML test console for this module — not a
  // real app screen. Lets you exercise signup/login/refresh/logout/Google
  // from a browser instead of curl. See public/console.html.
  //
  // Development only. It calls nothing that isn't already public, so it is
  // not a hole in itself, but it is a dev tool that advertises the auth
  // surface to anyone who guesses the path — no reason for it to exist on
  // a deployment real users can reach. Same "quietly skipped when not
  // applicable" shape as the optional integrations below.
  if (!isProduction) {
    app.get("/auth/console", async (_request, reply) => {
      reply.type("text/html").send(consoleHtml);
    });
  } else {
    app.log.info("[auth] /auth/console not registered (NODE_ENV=production)");
  }

  app.get("/auth/providers", async (_request, reply) => {
    reply.send({ google: googleOAuthConfigured });
  });

  if (googleOAuthConfigured) {
    await app.register(fastifyOauth2, {
      name: "googleOAuth2",
      scope: ["email", "profile"],
      credentials: {
        client: { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET },
        auth: GOOGLE_OAUTH_ENDPOINTS
      },
      startRedirectPath: "/auth/google",
      callbackUri: env.GOOGLE_CALLBACK_URL
    });

    app.get("/auth/google/callback", async (request, reply) => {
      const { token } = await app.googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);

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

      const { tokens } = await authService.loginWithGoogle({ googleId: profile.id, email: profile.email });

      // Browser redirect flow, not a JSON API call — there's no request
      // body to put tokens in, so they ride the redirect URL's fragment
      // instead of the query string (fragments never reach the server in
      // later requests/logs, unlike query params). Whatever frontend ends
      // up consuming this module reads them client-side from location.hash.
      const redirectUrl = new URL(env.OAUTH_SUCCESS_REDIRECT_URL);
      redirectUrl.hash = `access_token=${encodeURIComponent(tokens.accessToken)}&refresh_token=${encodeURIComponent(tokens.refreshToken)}`;
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
