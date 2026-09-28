// Route-level tests for POST /auth/google/exchange — the actual wire
// shape a client (web or mobile) sees. Drives the real handler through
// Fastify's inject(), same pattern as modules/tierlists/routes.test.ts.
// The other auth routes (signup/login/refresh/...) are exercised
// end-to-end elsewhere in this repo's manual test console and aren't
// re-tested here; this file is scoped to the Task 4A exchange endpoint,
// which is the only route in this file that touches no AuthService
// method at all (it reads/writes authorizationCode.ts's own module-level
// store directly) — so an unused stub AuthService is enough to register
// the full route set.
//
// Every path/secret env var is pointed at a throwaway temp directory
// BEFORE any module here is imported — routes.ts pulls in guard.ts ->
// tokens.ts -> config/env.ts transitively, and env.ts validates its
// entire schema (every module's *_DB_PATH included) at import time. Same
// reasoning as service.test.ts and tierlists/routes.test.ts.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import Fastify, { type InjectOptions } from "fastify";
import fastifyRateLimit from "@fastify/rate-limit";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const scratchDir = mkdtempSync(join(tmpdir(), "auth-routes-test-"));
process.env.JWT_ACCESS_SECRET ??= "a".repeat(64);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(64);
process.env.AUTH_DB_PATH ??= join(scratchDir, "auth.sqlite");
process.env.LIBRARY_DB_PATH ??= join(scratchDir, "library.sqlite");
process.env.GALLERY_DB_PATH ??= join(scratchDir, "gallery.sqlite");
process.env.GALLERY_STORAGE_PATH ??= join(scratchDir, "gallery-files");

const { buildAuthRoutes } = await import("./routes.js");
const { createAuthorizationCode } = await import("./authorizationCode.js");

import type { AuthenticatedUser, TokenPair } from "./domain/types.js";
import type { AuthService } from "./service.js";
import type { AccountAppearance, Appearance } from "@scripta/shared/themes";

const user: AuthenticatedUser = { id: "u1", email: "a@b.c", username: "andre", avatarId: null };
const tokens: TokenPair = { accessToken: "access-1", refreshToken: "refresh-1" };

function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// Nothing in the exchange route calls into AuthService — see this file's
// own top comment — so an empty stub is enough to satisfy buildAuthRoutes'
// parameter type without exercising any of its methods.
const unusedService = {} as AuthService;

async function call(options: InjectOptions) {
  const app = Fastify();
  await app.register(buildAuthRoutes(unusedService));
  const res = await app.inject(options);
  await app.close();
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

test("web flow: a code minted with no PKCE challenge exchanges with no verifier", async () => {
  const code = createAuthorizationCode({ user, tokens, codeChallenge: null });

  const { status, body } = await call({ method: "POST", url: "/auth/google/exchange", payload: { code } });

  assert.equal(status, 200);
  assert.deepEqual(body, { user, ...tokens });
});

test("mobile flow: a code minted with a PKCE challenge exchanges with the matching verifier", async () => {
  const verifier = "mobile-app-verifier-12345678901234567890123";
  const code = createAuthorizationCode({ user, tokens, codeChallenge: s256(verifier) });

  const { status, body } = await call({
    method: "POST",
    url: "/auth/google/exchange",
    payload: { code, codeVerifier: verifier }
  });

  assert.equal(status, 200);
  assert.deepEqual(body, { user, ...tokens });
});

test("missing code is a 400", async () => {
  const { status, body } = await call({ method: "POST", url: "/auth/google/exchange", payload: {} });
  assert.equal(status, 400);
  assert.equal(typeof body.error, "string");
});

test("an expired code is a 400", async () => {
  const code = createAuthorizationCode({ user, tokens, codeChallenge: null }, 10);
  await new Promise((resolve) => setTimeout(resolve, 25));

  const { status, body } = await call({ method: "POST", url: "/auth/google/exchange", payload: { code } });

  assert.equal(status, 400);
  assert.equal(typeof body.error, "string");
});

test("a replayed code is a 400 on the second attempt", async () => {
  const code = createAuthorizationCode({ user, tokens, codeChallenge: null });
  const first = await call({ method: "POST", url: "/auth/google/exchange", payload: { code } });
  assert.equal(first.status, 200);

  const second = await call({ method: "POST", url: "/auth/google/exchange", payload: { code } });
  assert.equal(second.status, 400);
});

test("a PKCE-bound code without a verifier is a 400 — the second-app scenario", async () => {
  const verifier = "mobile-app-verifier-12345678901234567890123";
  const code = createAuthorizationCode({ user, tokens, codeChallenge: s256(verifier) });

  const { status } = await call({ method: "POST", url: "/auth/google/exchange", payload: { code } });

  assert.equal(status, 400);
});

// BLOCKER 2(c) — no silent downgrade: a code minted with no PKCE challenge
// must reject a supplied codeVerifier rather than ignore it.
test("a codeVerifier supplied for a code with no bound challenge is a 400", async () => {
  const code = createAuthorizationCode({ user, tokens, codeChallenge: null });

  const { status } = await call({
    method: "POST",
    url: "/auth/google/exchange",
    payload: { code, codeVerifier: "unexpected-verifier-0000000000000000000000" }
  });

  assert.equal(status, 400);
});

test("a PKCE-bound code with the wrong verifier is a 400", async () => {
  const verifier = "mobile-app-verifier-12345678901234567890123";
  const code = createAuthorizationCode({ user, tokens, codeChallenge: s256(verifier) });

  const { status } = await call({
    method: "POST",
    url: "/auth/google/exchange",
    payload: { code, codeVerifier: "wrong-verifier-000000000000000000000000" }
  });

  assert.equal(status, 400);
});

function appearanceService(stored: Map<string, AccountAppearance>): AuthService {
  const empty: AccountAppearance = { theme: null, displayFont: null, textFont: null };
  return {
    getAppearance: (userId: string) => stored.get(userId) ?? empty,
    setAppearance: (userId: string, patch: Partial<Appearance>) => {
      stored.set(userId, { ...(stored.get(userId) ?? empty), ...patch });
    },
    getUserById: (userId: string) => (userId === user.id ? user : null),
  } as unknown as AuthService;
}

async function callAppearanceRoute(service: AuthService, options: InjectOptions, token?: string) {
  const app = Fastify();
  app.decorate("authenticateAccessToken", (candidate: string) => (candidate === "valid-token" ? user : null));
  await app.register(buildAuthRoutes(service));
  const res = await app.inject(token ? { ...options, headers: { ...options.headers, authorization: `Bearer ${token}` } } : options);
  await app.close();
  return { status: res.statusCode, body: res.body ? (res.json() as Record<string, unknown>) : null };
}

test("appearance routes reject a request without a valid access token", async () => {
  const service = appearanceService(new Map());
  assert.equal((await callAppearanceRoute(service, { method: "GET", url: "/auth/appearance" })).status, 401);
  assert.equal((await callAppearanceRoute(service, { method: "PUT", url: "/auth/appearance", payload: { theme: "dark" } })).status, 401);
  assert.equal((await callAppearanceRoute(service, { method: "GET", url: "/auth/appearance" }, "forged")).status, 401);
});

test("GET /auth/appearance is all null for an account that never chose anything", async () => {
  const { status, body } = await callAppearanceRoute(appearanceService(new Map()), { method: "GET", url: "/auth/appearance" }, "valid-token");
  assert.equal(status, 200);
  assert.deepEqual(body, { theme: null, displayFont: null, textFont: null });
});

test("a partial PUT round-trips one field without touching the others", async () => {
  const stored = new Map<string, AccountAppearance>();
  const service = appearanceService(stored);
  assert.equal((await callAppearanceRoute(service, { method: "PUT", url: "/auth/appearance", payload: { theme: "matrix" } }, "valid-token")).status, 204);
  assert.equal((await callAppearanceRoute(service, { method: "PUT", url: "/auth/appearance", payload: { displayFont: "pressStart" } }, "valid-token")).status, 204);
  const { body } = await callAppearanceRoute(service, { method: "GET", url: "/auth/appearance" }, "valid-token");
  assert.deepEqual(body, { theme: "matrix", displayFont: "pressStart", textFont: null });
});

test("PUT /auth/appearance rejects empty, unknown and slot-ineligible values", async () => {
  const stored = new Map<string, AccountAppearance>();
  const service = appearanceService(stored);
  for (const payload of [{}, { theme: "vaporwave" }, { displayFont: "atkinson" }, { textFont: "vt323" }, { textFont: null }, { theme: "dark", extra: 1 }, { font: "system" }]) {
    const { status, body } = await callAppearanceRoute(service, { method: "PUT", url: "/auth/appearance", payload }, "valid-token");
    assert.equal(status, 400, JSON.stringify(payload));
    assert.deepEqual(body, { error: "Unknown appearance." });
  }
  assert.equal(stored.size, 0);
});

test("the old /auth/theme routes are gone", async () => {
  const service = appearanceService(new Map());
  assert.equal((await callAppearanceRoute(service, { method: "GET", url: "/auth/theme" }, "valid-token")).status, 404);
});

test("appearance routes carry their own rate limit, separate from the shared auth limit", async () => {
  const service = appearanceService(new Map());
  const app = Fastify();
  await app.register(fastifyRateLimit, { max: 2, timeWindow: "1 minute" });
  app.decorate("authenticateAccessToken", (candidate: string) => (candidate === "valid-token" ? user : null));
  await app.register(buildAuthRoutes(service));

  const headers = { authorization: "Bearer valid-token" };
  for (let i = 0; i < 5; i++) {
    assert.equal((await app.inject({ method: "GET", url: "/auth/appearance", headers })).statusCode, 200, `GET #${i}`);
    assert.equal((await app.inject({ method: "PUT", url: "/auth/appearance", payload: { textFont: "atkinson" }, headers })).statusCode, 204, `PUT #${i}`);
  }
  assert.equal((await app.inject({ method: "GET", url: "/auth/me", headers })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/auth/me", headers })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/auth/me", headers })).statusCode, 429);
  await app.close();
});
