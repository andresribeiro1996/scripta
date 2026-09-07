// Registration-level tests for authPlugin — the thing the existing test
// suite never exercised before this review round: every other auth test
// either drives buildAuthRoutes directly (routes.test.ts) or a pure
// function in isolation, so nothing ever actually called
// `app.register(fastifyOauth2, {...})` with Google configured. That's
// exactly the gap BLOCKER 1 fell through — generateStateFunction was added
// without a checkStateFunction, and @fastify/oauth2 v8 rejects that
// combination at registration (`!a ^ !b` in its own index.js), so the
// backend never booted at all with GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL
// set. A plugin that merely *compiles* proves nothing here — only actually
// registering it does.
//
// Every path/secret env var is pointed at a throwaway temp directory
// BEFORE any module here is imported — same reasoning as routes.test.ts's
// own top comment (authPlugin pulls in config/env.ts transitively, which
// validates its entire schema at import time).

import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const scratchDir = mkdtempSync(join(tmpdir(), "auth-plugin-test-"));
process.env.JWT_ACCESS_SECRET ??= "a".repeat(40);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(40);
process.env.AUTH_DB_PATH ??= join(scratchDir, "auth.sqlite");
process.env.LIBRARY_DB_PATH ??= join(scratchDir, "library.sqlite");
process.env.GALLERY_DB_PATH ??= join(scratchDir, "gallery.sqlite");
process.env.GALLERY_STORAGE_PATH ??= join(scratchDir, "gallery-files");
process.env.AVATAR_STORAGE_PATH ??= join(scratchDir, "avatar-files");
// googleOAuthConfigured (config/env.ts) is true iff all three of these are
// non-blank — dummy values are fine, nothing here ever actually talks to
// Google (the callback route calls out to accounts.google.com, but this
// file only exercises registration and the /auth/google start route).
process.env.GOOGLE_CLIENT_ID ??= "dummy-client-id";
process.env.GOOGLE_CLIENT_SECRET ??= "dummy-client-secret";
process.env.GOOGLE_CALLBACK_URL ??= "http://localhost:3000/auth/google/callback";
process.env.OAUTH_SUCCESS_REDIRECT_URL ??= "http://localhost:5173/oauth-success";
process.env.MOBILE_OAUTH_REDIRECT_ALLOWLIST ??= "scripta://oauth-redirect";

const { authPlugin } = await import("./plugin.js");
const { googleOAuthConfigured } = await import("../../config/env.js");

test("googleOAuthConfigured is true for this file's env — otherwise the rest of this file tests nothing", () => {
  assert.equal(googleOAuthConfigured, true);
});

// BLOCKER 1's actual regression test: this used to reject at registration
// with "options.checkStateFunction and options.generateStateFunction have
// to be given" before checkStateFunction was added.
test("authPlugin registers and the app boots with Google OAuth configured", async () => {
  const app = Fastify();
  await app.register(authPlugin);
  await assert.doesNotReject(async () => {
    await app.ready();
  });
  await app.close();
});

test("GET /auth/google (no params) redirects to Google — the plain desktop-web start", async () => {
  const app = Fastify();
  await app.register(authPlugin);
  await app.ready();

  const res = await app.inject({ method: "GET", url: "/auth/google" });

  assert.equal(res.statusCode, 302);
  assert.ok(res.headers.location?.toString().startsWith("https://accounts.google.com"));
  assert.match(res.headers["set-cookie"]?.toString() ?? "", /oauth2-redirect-state=/);
  assert.doesNotMatch(res.headers["set-cookie"]?.toString() ?? "", /__Host-|Secure/);
  await app.close();
});

// BLOCKER 2(a) — PKCE must not be optional for a custom-scheme redirect
// target; this is the actual wiring test (googleStartRequest.test.ts
// covers the pure validation logic in isolation).
test("GET /auth/google with a redirect_target but no code_challenge is rejected", async () => {
  const app = Fastify();
  await app.register(authPlugin);
  await app.ready();

  const res = await app.inject({
    method: "GET",
    url: "/auth/google?redirect_target=scripta%3A%2F%2Foauth-redirect"
  });

  assert.equal(res.statusCode, 500);
  await app.close();
});

test("GET /auth/google with a PKCE-bound redirect_target succeeds", async () => {
  const app = Fastify();
  await app.register(authPlugin);
  await app.ready();

  const res = await app.inject({
    method: "GET",
    url: "/auth/google?redirect_target=scripta%3A%2F%2Foauth-redirect&code_challenge=abc123&code_challenge_method=S256"
  });

  assert.equal(res.statusCode, 302);
  await app.close();
});

// checkStateFunction must be a REAL check, not `() => true` — a callback
// hit with no redirect-state cookie at all (so definitely not the one this
// server's own /auth/google start set) must be rejected before ever
// reaching Google's token endpoint. This is a fast, deterministic way to
// tell "the check runs and rejects" apart from "it isn't checked" without
// mocking a real Google OAuth round trip: if checkStateFunction ever
// degraded to `() => true`, this request would instead try to exchange
// `code=whatever` with Google for real and fail differently (e.g. hang or
// error on the network call) rather than failing immediately here.
test("GET /auth/google/callback with no state cookie is rejected before any token exchange", async () => {
  const app = Fastify();
  await app.register(authPlugin);
  await app.ready();

  const res = await app.inject({
    method: "GET",
    url: "/auth/google/callback?code=whatever&state=attacker-supplied"
  });

  assert.equal(res.statusCode, 500);
  await app.close();
});

test("concurrent callbacks reject the one whose flow state was already consumed", async () => {
  const app = Fastify();
  await authPlugin(app);
  await app.ready();

  const start = await app.inject({ method: "GET", url: "/auth/google" });
  const location = new URL(start.headers.location?.toString() ?? "");
  const state = location.searchParams.get("state");
  assert.ok(state);

  const oauth = app.googleOAuth2 as unknown as {
    oauth2: { getToken: () => Promise<{ token: { access_token: string } }> };
  };
  oauth.oauth2.getToken = async () => ({ token: { access_token: "google-access-token" } });

  const originalFetch = globalThis.fetch;
  let profileRequests = 0;
  globalThis.fetch = async () => {
    profileRequests += 1;
    return new Response(JSON.stringify({ id: "google-user-1", email: "google@example.com" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const callback = {
      method: "GET" as const,
      url: `/auth/google/callback?code=provider-code&state=${encodeURIComponent(state)}`,
      headers: { cookie: `oauth2-redirect-state=${state}` }
    };
    const responses = await Promise.all([app.inject(callback), app.inject(callback)]);

    assert.deepEqual(
      responses.map((response) => response.statusCode).sort(),
      [302, 400]
    );
    assert.equal(profileRequests, 1);
    for (const response of responses) {
      assert.match(response.headers["set-cookie"]?.toString() ?? "", /oauth2-redirect-state=;/);
    }
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});
