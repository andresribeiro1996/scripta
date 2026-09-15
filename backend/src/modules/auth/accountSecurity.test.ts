import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";

const scratch = mkdtempSync(join(tmpdir(), "scripta-account-test-"));
process.env.JWT_ACCESS_SECRET ??= "a".repeat(40);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(40);
for (const key of ["AUTH_DB_PATH", "LIBRARY_DB_PATH", "GALLERY_DB_PATH", "GALLERY_STORAGE_PATH"]) process.env[key] ??= join(scratch, key);
const { applyAuthMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteAuthRepository } = await import("./adapters/sqlite/sqliteAuthRepository.js");
const { createAuthService } = await import("./service.js");
const { createAccountSecurity } = await import("./accountSecurity.js");
const { getAuthenticatedUserFromAccessToken, hashRefreshToken } = await import("./tokens.js");
const { buildAuthRoutes } = await import("./routes.js");
const { authGuard, getOptionalAuthenticatedUser } = await import("./guard.js");

function setup(enabled = true) {
  const db = new DatabaseSync(":memory:");
  applyAuthMigrations(db);
  const repo = createSqliteAuthRepository(db);
  const emails: { to: string; subject: string; text: string }[] = [];
  const security = createAccountSecurity(repo, async (to, subject, text) => { emails.push({ to, subject, text }); }, "https://scripta.example", enabled);
  const auth = createAuthService(repo, { save() {}, read() { return null; }, delete() {} });
  const token = () => new URLSearchParams(new URL(emails.at(-1)!.text.match(/https:\/\/\S+/)![0]).hash.slice(1)).get("token")!;
  return { db, repo, emails, security, auth, token };
}

test("reset revokes required and optional access, refresh rotation grace, and reused links", async () => {
  const { db, repo, auth, security, token, emails } = setup();
  try {
    const session = await auth.signup("reader@example.com", "reader", "old password");
    const rotated = await auth.refresh(session.tokens.refreshToken);
    await security.forgotPassword(" READER@example.com ");
    const resetToken = token();
    assert.equal(emails.length, 1);
    assert.notEqual(repo.findAccountToken(hashRefreshToken(resetToken), "reset")?.token_hash, resetToken);
    await security.forgotPassword("reader@example.com");
    assert.equal(emails.length, 1);
    await security.resetPassword(resetToken, "new password");
    assert.equal(getAuthenticatedUserFromAccessToken(session.tokens.accessToken, repo.findUserById), null);
    await assert.rejects(auth.refresh(rotated.refreshToken));
    await assert.rejects(auth.refresh(session.tokens.refreshToken));
    await assert.rejects(security.resetPassword(resetToken, "another password"));
    await assert.rejects(auth.login("reader", "old password"));
    const fresh = await auth.login("reader", "new password");
    const app = Fastify();
    app.decorate("authenticateAccessToken", (value: string) => getAuthenticatedUserFromAccessToken(value, repo.findUserById));
    app.get("/private", { preHandler: authGuard }, async () => ({}));
    app.get("/optional", async (request) => ({ user: getOptionalAuthenticatedUser(request) }));
    const headers = { authorization: `Bearer ${session.tokens.accessToken}` };
    assert.equal((await app.inject({ url: "/private", headers })).statusCode, 401);
    assert.equal((await app.inject({ url: "/optional", headers })).json().user, null);
    assert.equal((await app.inject({ url: "/private", headers: { authorization: `Bearer ${fresh.tokens.accessToken}` } })).statusCode, 200);
    await app.close();
  } finally { db.close(); }
});

test("expired, replaced and concurrently consumed reset tokens cannot change the password", async () => {
  const { db, auth, security, token } = setup();
  try {
    await auth.signup("reader@example.com", "reader", "old password");
    await security.forgotPassword("reader@example.com");
    const old = token();
    db.exec("UPDATE account_tokens SET expires_at = '2000-01-01'");
    await assert.rejects(security.resetPassword(old, "new password"));
    await security.forgotPassword("reader@example.com");
    const fresh = token();
    assert.notEqual(old, fresh);
    const results = await Promise.allSettled([security.resetPassword(fresh, "first password"), security.resetPassword(fresh, "second password")]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  } finally { db.close(); }
});

test("verification and email correction require the right purpose, password and mailbox", async () => {
  const { db, auth, security, token } = setup();
  try {
    const session = await auth.signup("reader@example.com", "reader", "old password");
    assert.equal(security.status(session.user.id).emailVerified, false);
    await security.requestVerification(session.user.id);
    await assert.rejects(security.resetPassword(token(), "new password"));
    security.verifyEmail(token());
    assert.equal(security.status(session.user.id).emailVerified, true);
    assert.throws(() => security.verifyEmail(token()));
    await assert.rejects(security.requestVerification(session.user.id, "correct@example.com", "wrong"));
    await security.requestVerification(session.user.id, "correct@example.com", "old password");
    assert.equal(security.status(session.user.id).email, "reader@example.com");
    security.verifyEmail(token());
    assert.equal(security.status(session.user.id).email, "correct@example.com");
    await assert.rejects(auth.refresh(session.tokens.refreshToken));
    await auth.login("correct@example.com", "old password");
  } finally { db.close(); }
});

test("changing password requires current credentials and revokes sessions", async () => {
  const { db, auth, security } = setup(false);
  try {
    const session = await auth.signup("reader@example.com", "reader", "old password");
    await assert.rejects(security.changePassword(session.user.id, "wrong", "new password"));
    await auth.login("reader", "old password");
    await security.changePassword(session.user.id, "old password", "new password");
    await assert.rejects(auth.login("reader", "old password"));
    await assert.rejects(auth.refresh(session.tokens.refreshToken));
    await auth.login("reader", "new password");
  } finally { db.close(); }
});

test("Google-only recovery sends guidance without creating a password", async () => {
  const { db, auth, security, emails } = setup();
  try {
    const { user } = await auth.loginWithGoogle({ googleId: "google1", email: "google@example.com" });
    await security.forgotPassword(user.email);
    assert.match(emails[0]!.text, /Google sign-in/);
    assert.equal(security.status(user.id).hasPassword, false);
    await security.forgotPassword(user.email);
    assert.equal(emails.length, 1);
  } finally { db.close(); }
});

test("recovery responses hide account existence, validate input and enforce IP throttling", async () => {
  const { db, auth, security } = setup();
  const app = Fastify();
  try {
    await auth.signup("reader@example.com", "reader", "old password");
    await app.register(rateLimit);
    await app.register(buildAuthRoutes(auth, security));
    const known = await app.inject({ method: "POST", url: "/auth/forgot-password", payload: { email: "reader@example.com" } });
    const unknown = await app.inject({ method: "POST", url: "/auth/forgot-password", payload: { email: "missing@example.com" } });
    assert.equal(known.statusCode, 202);
    assert.deepEqual(known.json(), unknown.json());
    assert.equal(known.headers["cache-control"], "no-store");
    assert.equal((await app.inject({ method: "POST", url: "/auth/forgot-password", payload: { email: "wrong" } })).statusCode, 400);
    for (let i = 0; i < 3; i++) await app.inject({ method: "POST", url: "/auth/forgot-password", payload: { email: "missing@example.com" } });
    assert.equal((await app.inject({ method: "POST", url: "/auth/forgot-password", payload: { email: "missing@example.com" } })).statusCode, 429);
    assert.equal((await app.inject({ method: "POST", url: "/auth/reset-password", payload: { token: "invalid", password: "short" } })).statusCode, 400);
  } finally { await app.close(); db.close(); }
});
