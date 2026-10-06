import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { TRUSTED_PROXIES } from "../../config/trustedProxies.js";

const scratch = mkdtempSync(join(tmpdir(), "scripta-account-test-"));
process.env.JWT_ACCESS_SECRET ??= "a".repeat(64);
process.env.JWT_REFRESH_SECRET ??= "b".repeat(64);
for (const key of ["AUTH_DB_PATH", "LIBRARY_DB_PATH", "GALLERY_DB_PATH"]) process.env[key] ??= join(scratch, key);
const { applyAuthMigrations } = await import("./adapters/sqlite/connection.js");
const { createSqliteAuthRepository } = await import("./adapters/sqlite/sqliteAuthRepository.js");
const { createAuthService } = await import("./service.js");
const { createAccountSecurity } = await import("./accountSecurity.js");
const { getAuthenticatedUserFromAccessToken, hashRefreshToken } = await import("./tokens.js");
const { buildAuthRoutes } = await import("./routes.js");
const { authGuard, getOptionalAuthenticatedUser, rateLimitKey } = await import("./guard.js");

function setup(enabled = true) {
  const db = new DatabaseSync(":memory:");
  applyAuthMigrations(db);
  const repo = createSqliteAuthRepository(db);
  const emails: { to: string; subject: string; text: string; html?: string }[] = [];
  const erased: string[] = [];
  let eraseFails = false;
  const security = createAccountSecurity(repo, async (to, subject, text, html) => { emails.push({ to, subject, text, html }); }, "https://scripta.example", enabled, async (userId) => {
    if (eraseFails) throw new Error("erase failed");
    erased.push(userId);
  });
  const auth = createAuthService(repo, { save: async () => {}, delete: async () => {} });
  const token = () => new URLSearchParams(new URL(emails.at(-1)!.text.match(/https:\/\/\S+/)![0]).hash.slice(1)).get("token")!;
  return { db, repo, emails, erased, security, auth, token, failErase: () => { eraseFails = true; } };
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

test("rateLimitKey is the account for a valid token and the prefixed, normalized address for a missing or invalid one", async () => {
  const { db, repo, auth } = setup();
  const app = Fastify();
  try {
    const session = await auth.signup("reader@example.com", "reader", "a password");
    app.decorate("authenticateAccessToken", (value: string) => getAuthenticatedUserFromAccessToken(value, repo.findUserById));
    app.get("/key", async (request) => ({ key: rateLimitKey(request) }));
    const keyFor = async (headers: Record<string, string>, remoteAddress = "203.0.113.7") => (await app.inject({ url: "/key", headers, remoteAddress })).json().key;
    assert.equal(await keyFor({ authorization: `Bearer ${session.tokens.accessToken}` }), `user:${session.user.id}`);
    assert.equal(await keyFor({}), "ip:203.0.113.7");
    assert.equal(await keyFor({ authorization: "Bearer not-a-token" }), "ip:203.0.113.7");
    assert.equal(await keyFor({}, "::ffff:203.0.113.7"), "ip:203.0.113.7");
    assert.equal(await keyFor({}, "2001:db8:0:1::5"), await keyFor({}, "2001:db8:0:1:ffff::9"));
    assert.notEqual(await keyFor({}, "2001:db8:0:1::5"), await keyFor({}, "2001:db8:0:2::5"));
  } finally {
    await app.close();
    db.close();
  }
});

test("an anonymous caller forging X-Forwarded-For as another account's key cannot spend that account's rate limit", async () => {
  const { db, repo, auth } = setup();
  const app = Fastify({ trustProxy: TRUSTED_PROXIES });
  try {
    const session = await auth.signup("reader@example.com", "reader", "a password");
    app.decorate("authenticateAccessToken", (value: string) => getAuthenticatedUserFromAccessToken(value, repo.findUserById));
    await app.register(rateLimit, { max: 3, timeWindow: "1 minute", keyGenerator: rateLimitKey });
    app.get("/limited", { preHandler: authGuard }, async () => ({}));
    const forged = { "x-forwarded-for": `user:${session.user.id}, 172.64.9.9` };
    const anonymous = () => app.inject({ url: "/limited", headers: forged, remoteAddress: "100.64.0.9" });
    for (let sent = 0; sent < 3; sent++) assert.equal((await anonymous()).statusCode, 401);
    assert.equal((await anonymous()).statusCode, 429);
    const owner = await app.inject({ url: "/limited", headers: { authorization: `Bearer ${session.tokens.accessToken}` }, remoteAddress: "100.64.0.9" });
    assert.equal(owner.statusCode, 200);
  } finally {
    await app.close();
    db.close();
  }
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

test("recovery and verification emails carry the link in both the text and html parts", async () => {
  const { db, auth, security, emails } = setup();
  try {
    const session = await auth.signup("reader@example.com", "reader", "old password");
    await security.requestVerification(session.user.id);
    await security.forgotPassword("reader@example.com");
    assert.equal(emails.length, 2);
    for (const mail of emails) {
      const link = mail.text.match(/https:\/\/\S+/)![0];
      assert.ok(mail.html?.includes(`href="${link}"`));
    }
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
    await app.register(buildAuthRoutes(auth, () => "", security));
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

test("deleting an account needs the password, signs out everywhere, erases every module and removes the user", async () => {
  const { db, repo, auth, security, emails, erased } = setup();
  try {
    const session = await auth.signup("reader@example.com", "reader", "a password");
    const userId = session.user.id;
    await assert.rejects(security.deleteAccount(userId, "wrong password"), { status: 403 });
    await assert.rejects(security.deleteAccount(userId), { status: 403 });
    assert.deepEqual(erased, []);
    assert.ok(repo.findUserById(userId));
    await security.deleteAccount(userId, "a password");
    assert.deepEqual(erased, [userId]);
    assert.equal(repo.findUserById(userId), undefined);
    assert.equal(getAuthenticatedUserFromAccessToken(session.tokens.accessToken, repo.findUserById), null);
    await assert.rejects(auth.refresh(session.tokens.refreshToken));
    await assert.rejects(auth.login("reader", "a password"));
    assert.equal(emails.at(-1)?.subject, "Your Atmyshelf account was deleted");
    assert.ok(await auth.signup("reader@example.com", "reader", "a password"));
  } finally { db.close(); }
});

test("an account without a password confirms deletion by typing its username", async () => {
  const { db, repo, security, erased } = setup(false);
  try {
    const user = repo.createUser({ email: "google@example.com", username: "Reader", passwordHash: null, googleId: "google-1" });
    await assert.rejects(security.deleteAccount(user.id, "a password"), { status: 403 });
    await assert.rejects(security.deleteAccount(user.id, undefined, "someone"), { status: 403 });
    await security.deleteAccount(user.id, undefined, " reader ");
    assert.deepEqual(erased, [user.id]);
    assert.equal(repo.findUserById(user.id), undefined);
  } finally { db.close(); }
});

test("a rejected erase fails the deletion and keeps the account so deleting again can finish the job", async () => {
  const { db, repo, auth, security, failErase } = setup();
  try {
    const session = await auth.signup("reader@example.com", "reader", "a password");
    failErase();
    await assert.rejects(security.deleteAccount(session.user.id, "a password"), /erase failed/);
    assert.ok(repo.findUserById(session.user.id));
    assert.equal(getAuthenticatedUserFromAccessToken(session.tokens.accessToken, repo.findUserById), null);
    assert.ok(await auth.login("reader", "a password"));
  } finally { db.close(); }
});
